import { randomUUID, createHash } from 'node:crypto';
import { Transaction, getAddress, JsonRpcProvider, computeAddress, FetchRequest } from 'ethers';
import { config } from './config.js';
import { transaction, audit, authorization, TxRow } from './db.js';
import {
  Approval,
  PolicyEnvelope,
  authorize,
  binding,
  canonical,
  parseTransfer,
  requestSchema,
  requireThat,
  validateApproval,
  validatePolicy,
} from './domain.js';
import { protocol } from './mpc.js';
import { callSigner } from './tls.js';
const rpcRequest = new FetchRequest(config().rpcUrl);
rpcRequest.timeout = 5000;
rpcRequest.retryFunc = async () => false;
export const chain = new JsonRpcProvider(rpcRequest, 31337, {
  staticNetwork: true,
  batchMaxCount: 1,
});
export async function ensureLocalChain() {
  requireThat(BigInt(await chain.send('eth_chainId', [])) === 31337n, 'wrong_chain');
}
export async function createWallet(actor: string) {
  const id = randomUUID();
  const result = await protocol('dkg', id);
  const address = computeAddress(result.publicKey);
  await ensureLocalChain();
  const nonce = await chain.getTransactionCount(address, 'pending');
  await transaction(async (client) => {
    await client.query(
      'INSERT INTO wallets(id,public_key,address,next_nonce) VALUES($1,$2,$3,$4)',
      [id, result.publicKey, address, nonce],
    );
    await audit(client, actor, 'wallet_created', null, {
      walletId: id,
      address,
      protocol: 'cb-mpc/2-of-3/secp256k1',
    });
  });
  return { id, address, publicKey: result.publicKey };
}
export async function createRequest(actor: string, key: string, input: unknown) {
  requireThat(/^[a-zA-Z0-9_-]{8,80}$/.test(key), 'idempotency_key_required');
  const request = requestSchema.parse(input);
  request.recipient = getAddress(request.recipient);
  const requestHash = createHash('sha256').update(canonical(request)).digest('hex');
  // No RPC while holding a database transaction. Fees are explicitly bounded demo defaults.
  await ensureLocalChain();
  return transaction(async (client) => {
    // Actor-scoped idempotency lock also covers requests aimed at different wallets.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [actor + ':' + key]);
    const existing = (
      await client.query('SELECT * FROM transactions WHERE requester=$1 AND idempotency_key=$2', [
        actor,
        key,
      ])
    ).rows[0];
    if (existing) {
      requireThat(existing.request_hash === requestHash, 'idempotency_conflict', 409);
      return existing;
    }
    const envelope = (await client.query('SELECT envelope FROM policy WHERE id=1 FOR SHARE'))
      .rows[0].envelope as PolicyEnvelope;
    const wallet = (
      await client.query('SELECT * FROM wallets WHERE id=$1 FOR UPDATE', [request.walletId])
    ).rows[0];
    requireThat(wallet, 'wallet_not_found', 404);
    requireThat(Number(wallet.next_nonce) < 1000, 'development_transaction_quota');
    const tx = Transaction.from({
      type: 2,
      chainId: 31337,
      nonce: Number(wallet.next_nonce),
      to: request.recipient,
      value: BigInt(request.value),
      gasLimit: 21000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      data: '0x',
      accessList: [],
    });
    parseTransfer(tx.unsignedSerialized, envelope.policy);
    const reserved = tx.value + tx.gasLimit * tx.maxFeePerGas!;
    requireThat(
      BigInt(wallet.reserved) + reserved <= BigInt(envelope.policy.aggregate),
      'aggregate_limit',
    );
    const id = randomUUID(),
      expires = new Date(Date.now() + 900_000);
    const row = (
      await client.query(
        `INSERT INTO transactions(id,wallet_id,requester,idempotency_key,request_hash,recipient,value,chain_id,nonce,max_fee,priority_fee,gas_limit,calldata,unsigned,digest,policy_version,expires_at,reserved,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,31337,$8,$9,$10,21000,'0x',$11,$12,$13,$14,$15,'awaiting_approvals') RETURNING *`,
        [
          id,
          request.walletId,
          actor,
          key,
          requestHash,
          request.recipient,
          request.value,
          tx.nonce,
          tx.maxFeePerGas!.toString(),
          tx.maxPriorityFeePerGas!.toString(),
          tx.unsignedSerialized,
          tx.unsignedHash,
          envelope.policy.version,
          expires,
          reserved.toString(),
        ],
      )
    ).rows[0];
    await client.query(
      'UPDATE wallets SET next_nonce=next_nonce+1,reserved=reserved+$2 WHERE id=$1',
      [request.walletId, reserved.toString()],
    );
    await audit(client, actor, 'transaction_requested', id, {
      digest: tx.unsignedHash,
      policyVersion: envelope.policy.version,
      nonce: tx.nonce,
    });
    return row;
  });
}
export async function approve(id: string, actor: string, approval: Approval) {
  requireThat(approval.actor === actor, 'actor_mismatch', 403);
  return transaction(async (client) => {
    const envelope = (await client.query('SELECT envelope FROM policy WHERE id=1 FOR SHARE'))
      .rows[0].envelope as PolicyEnvelope;
    const row = (await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [id]))
      .rows[0] as TxRow;
    requireThat(row, 'not_found', 404);
    requireThat(row.state === 'awaiting_approvals', 'approval_state_conflict', 409);
    const auth = await authorization(row, client);
    validateApproval(auth, approval, config().actors, envelope.policy);
    requireThat(!auth.approvals.some((a) => a.actor === actor), 'duplicate_approver', 409);
    await client.query(
      'INSERT INTO approvals(transaction_id,actor,signature,digest,policy_version,expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, actor, approval.signature, row.digest, row.policy_version, row.expires_at],
    );
    auth.approvals.push(approval);
    if (auth.approvals.length >= envelope.policy.requiredApprovers) {
      authorize(auth, config().actors, envelope);
      await client.query("UPDATE transactions SET state='ready',updated_at=now() WHERE id=$1", [
        id,
      ]);
    }
    await audit(client, actor, 'approval_recorded', id, {
      ...binding(auth),
      state:
        auth.approvals.length >= envelope.policy.requiredApprovers ? 'ready' : 'awaiting_approvals',
    });
    return {
      state:
        auth.approvals.length >= envelope.policy.requiredApprovers ? 'ready' : 'awaiting_approvals',
    };
  });
}
export async function updatePolicy(actor: string, envelope: PolicyEnvelope) {
  validatePolicy(envelope, config().actors);
  await transaction(async (client) => {
    const current = (await client.query('SELECT envelope FROM policy WHERE id=1 FOR UPDATE'))
      .rows[0].envelope as PolicyEnvelope;
    requireThat(
      envelope.policy.version === current.policy.version + 1 ||
        canonical(envelope) === canonical(current),
      'policy_version_conflict',
      409,
    );
    if (canonical(envelope) !== canonical(current)) {
      requireThat(
        (await client.query("SELECT 1 FROM transactions WHERE state='signing' LIMIT 1"))
          .rowCount === 0,
        'signing_in_progress',
        409,
      );
      await client.query('UPDATE policy SET envelope=$1 WHERE id=1', [envelope]);
      const blocked = (
        await client.query(
          "UPDATE transactions SET state='blocked',error='policy_changed',updated_at=now() WHERE state IN ('awaiting_approvals','ready') RETURNING id,digest",
        )
      ).rows;
      for (const tx of blocked)
        await audit(client, actor, 'policy_invalidated_transaction', tx.id, {
          digest: tx.digest,
          policyVersion: envelope.policy.version,
        });
      await audit(client, actor, 'policy_changed', null, {
        policyVersion: envelope.policy.version,
      });
    }
  });
  const outcomes = await Promise.allSettled(
    config().signers.map((s) => callSigner('coordinator', s.id, '/policy', envelope)),
  );
  requireThat(
    outcomes.every((o) => o.status === 'fulfilled'),
    'policy_sync_pending',
    503,
  );
  return envelope;
}
export async function reapprove(id: string, actor: string, input: unknown) {
  return transaction(async (client) => {
    const envelope = (await client.query('SELECT envelope FROM policy WHERE id=1 FOR SHARE'))
      .rows[0].envelope as PolicyEnvelope;
    const row = (await client.query('SELECT * FROM transactions WHERE id=$1 FOR UPDATE', [id]))
      .rows[0] as TxRow;
    requireThat(row, 'not_found', 404);
    requireThat(row.requester === actor, 'requester_required', 403);
    requireThat(
      ['awaiting_approvals', 'ready', 'blocked'].includes(row.state) && row.sign_attempts === 0,
      'cannot_edit_after_signing',
      409,
    );
    const request = requestSchema.parse(input);
    requireThat(request.walletId === row.wallet_id, 'wallet_changed');
    const tx = Transaction.from(row.unsigned);
    tx.to = getAddress(request.recipient);
    tx.value = BigInt(request.value);
    parseTransfer(tx.unsignedSerialized, envelope.policy);
    const reserved = tx.value + tx.gasLimit * tx.maxFeePerGas!;
    const wallet = (
      await client.query('SELECT reserved FROM wallets WHERE id=$1 FOR UPDATE', [row.wallet_id])
    ).rows[0];
    requireThat(
      BigInt(wallet.reserved) - BigInt(row.reserved) + reserved <=
        BigInt(envelope.policy.aggregate),
      'aggregate_limit',
    );
    await client.query('UPDATE wallets SET reserved=reserved-$2+$3 WHERE id=$1', [
      row.wallet_id,
      row.reserved,
      reserved.toString(),
    ]);
    await client.query('DELETE FROM approvals WHERE transaction_id=$1', [id]);
    await client.query(
      "UPDATE transactions SET recipient=$2,value=$3,unsigned=$4,digest=$5,policy_version=$6,expires_at=$7,reserved=$8,state='awaiting_approvals',error=NULL,updated_at=now() WHERE id=$1",
      [
        id,
        tx.to,
        tx.value.toString(),
        tx.unsignedSerialized,
        tx.unsignedHash,
        envelope.policy.version,
        new Date(Date.now() + 900_000),
        reserved.toString(),
      ],
    );
    await audit(client, actor, 'reapproval_required', id, {
      oldDigest: row.digest,
      digest: tx.unsignedHash,
      policyVersion: envelope.policy.version,
    });
    return { digest: tx.unsignedHash };
  });
}
