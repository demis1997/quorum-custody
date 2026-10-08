import { randomUUID } from 'node:crypto';
import { Transaction } from 'ethers';
import { pool, transaction, audit, policy, authorization, TxRow } from './db.js';
import { authorize, Rejection, requireThat, transition } from './domain.js';
import { config } from './config.js';
import { chain, ensureLocalChain } from './custody.js';
import { availability, protocol, signedTransaction } from './mpc.js';
export async function claim(): Promise<TxRow | undefined> {
  return transaction(async (client) => {
    // This lock serializes policy changes with claiming a signing operation.
    await client.query('SELECT id FROM policy WHERE id=1 FOR SHARE');
    const expired = (
      await client.query(
        'SELECT * FROM transactions WHERE owner IS NOT NULL AND lease_until<now() FOR UPDATE SKIP LOCKED',
      )
    ).rows as TxRow[];
    for (const row of expired) {
      const state =
        row.state === 'signing' ? (row.sign_attempts < 3 ? 'ready' : 'blocked') : row.state;
      await client.query(
        'UPDATE transactions SET state=$2,owner=NULL,lease_until=NULL,error=$3,updated_at=now() WHERE id=$1',
        [row.id, state, 'worker_lease_expired'],
      );
      await audit(client, 'worker', 'lease_recovered', row.id, {
        from: row.state,
        to: state,
        digest: row.digest,
      });
    }
    const row = (
      await client.query(`SELECT t.* FROM transactions t WHERE state IN ('ready','signed','broadcast') AND owner IS NULL AND updated_at<now()-interval '1 second'
      AND NOT EXISTS(SELECT 1 FROM transactions earlier WHERE earlier.wallet_id=t.wallet_id AND earlier.nonce<t.nonce AND earlier.state<>'confirmed')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`)
    ).rows[0] as TxRow | undefined;
    if (!row) return undefined;
    const owner = randomUUID();
    const state = row.state === 'ready' ? 'signing' : row.state;
    if (state !== row.state) transition(row.state as 'ready', 'signing');
    await client.query(
      "UPDATE transactions SET state=$2,owner=$3,lease_until=now()+interval '45 seconds',sign_attempts=sign_attempts+$4,updated_at=now() WHERE id=$1",
      [row.id, state, owner, row.state === 'ready' ? 1 : 0],
    );
    await audit(client, 'worker', 'worker_claimed', row.id, {
      from: row.state,
      to: state,
      digest: row.digest,
      policyVersion: row.policy_version,
    });
    return {
      ...row,
      owner,
      state,
      sign_attempts: row.sign_attempts + (row.state === 'ready' ? 1 : 0),
    };
  });
}
export async function fencedUpdate(row: TxRow, to: string, extra: Record<string, unknown> = {}) {
  return transaction(async (client) => {
    const current = (
      await client.query(
        'SELECT state,owner,lease_until FROM transactions WHERE id=$1 FOR UPDATE',
        [row.id],
      )
    ).rows[0];
    requireThat(
      current.owner === row.owner && current.lease_until > Date.now(),
      'worker_ownership_lost',
      409,
    );
    if (current.state !== to) transition(current.state, to as 'signed');
    const allowed = ['signed_raw', 'tx_hash', 'receipt', 'error', 'broadcast_attempts'];
    requireThat(
      Object.keys(extra).every((k) => allowed.includes(k)),
      'invalid_update',
    );
    const columns = Object.keys(extra);
    const values = Object.values(extra);
    const assignments = columns.map((column, i) => `${column}=$${i + 3}`).join(',');
    await client.query(
      `UPDATE transactions SET state=$2,owner=NULL,lease_until=NULL,updated_at=now()${assignments ? ',' + assignments : ''} WHERE id=$1`,
      [row.id, to, ...values],
    );
    await audit(client, 'worker', 'state_transition', row.id, {
      from: current.state,
      to,
      digest: row.digest,
      policyVersion: row.policy_version,
      ...(extra.error ? { reason: extra.error } : {}),
      ...(extra.tx_hash ? { hash: extra.tx_hash } : {}),
    });
  });
}
export async function processClaim(row: TxRow) {
  const heartbeat = setInterval(() => {
    void pool
      .query(
        "UPDATE transactions SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND owner=$2 AND lease_until>now()",
        [row.id, row.owner],
      )
      .catch(() => undefined);
  }, 5000);
  try {
    if (row.state === 'signing') {
      const envelope = await policy();
      const peers = await availability();
      requireThat(
        peers.filter((s) => s.available && s.policyVersion === envelope.policy.version).length >= 2,
        'insufficient_quorum',
        503,
      );
      const auth = await authorization(row);
      authorize(auth, config().actors, envelope);
      const result = await protocol('sign', row.wallet_id, auth);
      const signed = signedTransaction(auth, result);
      await fencedUpdate(row, 'signed', {
        signed_raw: signed.raw,
        tx_hash: signed.hash,
        error: null,
      });
      return;
    }
    requireThat(row.signed_raw && row.tx_hash, 'missing_signed_transaction');
    const tx = Transaction.from(row.signed_raw);
    requireThat(
      tx.hash === row.tx_hash && tx.unsignedSerialized === row.unsigned,
      'persisted_signed_transaction_mismatch',
    );
    await ensureLocalChain();
    const receipt = await chain.getTransactionReceipt(row.tx_hash);
    if (receipt) {
      await fencedUpdate(row, 'confirmed', {
        receipt: receipt.toJSON(),
        error: receipt.status === 1 ? null : 'chain_reverted',
      });
      return;
    }
    const known = await chain.getTransaction(row.tx_hash);
    if (known) {
      await fencedUpdate(row, 'broadcast', { error: null });
      return;
    }
    if (row.broadcast_attempts >= 5) {
      await fencedUpdate(row, 'blocked', { error: 'broadcast_retry_limit_reconcile_manually' });
      return;
    }
    // Record attempt before RPC. If RPC response is lost, the next claim reconciles this same hash.
    const attempt = await pool.query(
      'UPDATE transactions SET broadcast_attempts=broadcast_attempts+1 WHERE id=$1 AND owner=$2 AND lease_until>now() RETURNING id',
      [row.id, row.owner],
    );
    requireThat(attempt.rowCount === 1, 'worker_ownership_lost', 409);
    try {
      const returned = await chain.send('eth_sendRawTransaction', [row.signed_raw]);
      requireThat(returned === row.tx_hash, 'broadcast_hash_mismatch');
      await fencedUpdate(row, 'broadcast', { error: null });
    } catch {
      await fencedUpdate(row, row.state, { error: 'broadcast_outcome_ambiguous' });
    }
  } catch (error) {
    const code = error instanceof Rejection ? error.code : 'worker_operation_failed';
    if (code === 'worker_ownership_lost') return;
    const retryable = [
      'insufficient_quorum',
      'signer_busy',
      'signer_timeout',
      'native_transport_failed',
      'native_session_timeout',
      'worker_operation_failed',
      'session_cancelled',
    ];
    const next =
      row.state === 'signing'
        ? retryable.includes(code) && row.sign_attempts < 3
          ? 'ready'
          : 'blocked'
        : row.state;
    try {
      await fencedUpdate(row, next, { error: code });
    } catch {
      /* A fenced-out worker cannot change state. */
    }
  } finally {
    clearInterval(heartbeat);
  }
}
export function startWorker() {
  let stopped = false,
    running = false;
  const timer = setInterval(async () => {
    if (stopped || running) return;
    running = true;
    try {
      const row = await claim();
      if (row) await processClaim(row);
    } catch {
      console.log(JSON.stringify({ event: 'worker_tick_failed' }));
    } finally {
      running = false;
    }
  }, 500);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
