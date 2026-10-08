// Runs against REAL cb-mpc, PostgreSQL and Anvil. No crypto, DB or RPC mocks.
import assert from 'node:assert/strict';
import { randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import { JsonRpcProvider, Transaction } from 'ethers';
import { config, dev } from '../src/config.js';
import { pool, policy, TxRow } from '../src/db.js';
import { claim, processClaim, fencedUpdate } from '../src/worker.js';
import { protocol, signedTransaction } from '../src/mpc.js';
import { callSigner, tlsOptions } from '../src/tls.js';
import { authorize, policyText, Authorization } from '../src/domain.js';
import { request, actor, approveAs } from '../scripts/client.js';
import { stopProcess, restartProcess } from '../scripts/processes.js';
const chain = new JsonRpcProvider(config().rpcUrl);
let passed = 0;
async function check(name: string, run: () => Promise<void>) {
  await run();
  passed++;
  console.log('PASS ' + name);
}
async function readyWallet() {
  const w = await request<{ id: string; address: string }>('admin', '/wallets', {});
  await chain.send('anvil_setBalance', [w.address, '0x8ac7230489e80000']);
  return w;
}
async function create(
  walletId: string,
  value = '10000000000000000',
  who = 'requester',
  key = 'test-' + randomUUID(),
) {
  const p = await policy();
  return request<TxRow>(
    who,
    '/transactions',
    { walletId, recipient: p.policy.recipients[0], value },
    key,
  );
}
async function signedApprovals(row: TxRow) {
  await approveAs('alice', row.id);
  await approveAs('bob', row.id);
}
async function details(id: string) {
  return request<{ authorization: Authorization; transaction: TxRow }>(
    'admin',
    '/transactions/' + id,
  );
}
async function ownClaim(id: string) {
  await sleep(1100);
  for (let n = 0; n < 20; n++) {
    const row = await claim();
    if (!row) throw new Error('expected_worker_claim');
    if (row.id === id) return row;
    await processClaim(row);
    await sleep(1100);
  }
  throw new Error('claim_not_reached');
}
async function nativeSingle(auth: Authorization) {
  const path = resolve(dev, 'signer-1');
  try {
    execFileSync(
      resolve('.build/quorum-signer'),
      [
        'sign',
        config().signers[0].fingerprint.replaceAll(':', '').toLowerCase(),
        config().signers[0].fingerprint.replaceAll(':', '').toLowerCase(),
        resolve(path, auth.walletId + '.share'),
        resolve(path, 'wrapping.key'),
        auth.walletId,
        auth.digest.slice(2),
        config()
          .signers.map((s) => s.fingerprint.replaceAll(':', '').toLowerCase())
          .join(','),
      ],
      { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    throw new Error('single_native_signer_succeeded');
  } catch (error) {
    const output = (error as { stdout?: Buffer }).stdout?.toString();
    assert.ok(output?.startsWith('FAIL '));
    assert.ok(!output?.includes('DONE'));
  }
}
stopProcess('node', 'SIGKILL');
await sleep(300);
restartProcess('node', { QUORUM_NO_WORKER: '1' });
await sleep(1100);
try {
  await check(
    'API authentication, role authorization and no arbitrary-digest signing route',
    async () => {
      assert.equal(
        (await fetch(`http://127.0.0.1:${config().ports?.api ?? 4300}/api/overview`)).status,
        401,
      );
      await assert.rejects(() => request('requester', '/wallets', {}), /role_forbidden/);
      await assert.rejects(
        () => request('requester', '/sign', { digest: '00'.repeat(32) }),
        /not_found/,
      );
    },
  );
  await check('mTLS rejects clients without a certificate', async () => {
    await assert.rejects(
      () =>
        new Promise((resolveResponse, reject) => {
          const req = https.get(
            new URL('/health', config().signers[0].url),
            { ca: tlsOptions('coordinator').ca, minVersion: 'TLSv1.3' },
            resolveResponse,
          );
          req.on('error', reject);
        }),
    );
  });
  const wallet = await readyWallet();
  await check(
    'real DKG matches address derivation; all three online shares remain separate',
    async () => {
      const w = (
        await pool.query('SELECT public_key,address FROM wallets WHERE id=$1', [wallet.id])
      ).rows[0];
      assert.equal((await import('ethers')).computeAddress(w.public_key), w.address);
      for (const s of config().signers)
        assert.ok(readFileSync(resolve(dev, s.id, wallet.id + '.share')).length > 28);
    },
  );
  let tx = await create(wallet.id);
  await check('duplicate requests are idempotent; conflicting payload is rejected', async () => {
    const key = 'duplicate-' + randomUUID();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => create(wallet.id, '20000000000000000', 'requester', key)),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    await assert.rejects(
      () => create(wallet.id, '30000000000000000', 'requester', key),
      /idempotency_conflict/,
    );
    // Block the second nonce while testing the first; it is never signed without approval.
  });
  await check(
    'insufficient approvals, duplicate approvers and forbidden self-approval',
    async () => {
      await approveAs('alice', tx.id);
      await assert.rejects(() => approveAs('alice', tx.id), /duplicate_approver/);
      const auth = (await details(tx.id)).authorization;
      assert.throws(
        () => authorize(auth, config().actors, auth.policyEnvelope),
        /insufficient_approvals/,
      );
      const self = await create(wallet.id, '1000000', 'alice');
      await assert.rejects(() => approveAs('alice', self.id), /self_approval/);
    },
  );
  await approveAs('bob', tx.id);
  await check(
    'each signer rejects recipient, amount, fee and chain mutation after approval',
    async () => {
      const auth = (await details(tx.id)).authorization;
      for (const field of ['recipient', 'value', 'fee', 'chain']) {
        const altered = Transaction.from(auth.unsigned);
        if (field === 'recipient') altered.to = '0x0000000000000000000000000000000000000001';
        if (field === 'value') altered.value++;
        if (field === 'fee') altered.maxFeePerGas = 2500000000n;
        if (field === 'chain') altered.chainId = 1n;
        await assert.rejects(() =>
          protocol('sign', wallet.id, { ...auth, unsigned: altered.unsignedSerialized }),
        );
      }
    },
  );
  await check(
    'real two-party signing succeeds with signer-3 offline and native one-party signing fails',
    async () => {
      stopProcess('signer-3');
      await sleep(300);
      const row = await ownClaim(tx.id);
      await processClaim(row);
      const persisted = (await pool.query('SELECT * FROM transactions WHERE id=$1', [tx.id]))
        .rows[0] as TxRow;
      assert.equal(persisted.state, 'signed');
      assert.equal(Transaction.from(persisted.signed_raw!).hash, persisted.tx_hash);
      await nativeSingle((await details(tx.id)).authorization);
      restartProcess('signer-3');
      await sleep(500);
    },
  );
  await check(
    'independently verified signature broadcasts and receives a successful local-chain receipt',
    async () => {
      await processClaim(await ownClaim(tx.id));
      await processClaim(await ownClaim(tx.id));
      const row = (await pool.query('SELECT * FROM transactions WHERE id=$1', [tx.id])).rows[0];
      assert.equal(row.state, 'confirmed');
      assert.equal((await chain.getTransactionReceipt(row.tx_hash))?.status, 1);
    },
  );
  await check(
    'signing with each alternate supported quorum produces independently valid ECDSA',
    async () => {
      const wallet2 = await readyWallet();
      const row = await create(wallet2.id);
      await signedApprovals(row);
      const auth = (await details(row.id)).authorization;
      for (const participants of [
        ['signer-1', 'signer-3'],
        ['signer-2', 'signer-3'],
      ]) {
        const result = await protocol('sign', wallet2.id, auth, participants);
        const signed = signedTransaction(auth, result);
        assert.equal(Transaction.from(signed.raw).from, wallet2.address);
      }
      // Mark this unsigned request blocked: its local signer reservations remain conservative.
      await pool.query(
        "UPDATE transactions SET state='blocked',error='integration_only_quorum_check' WHERE id=$1",
        [row.id],
      );
    },
  );
  await check(
    'session mismatch, unauthorized session peer, replay and bounded timeout',
    async () => {
      await assert.rejects(
        () => callSigner('coordinator', 'signer-1', '/run', { session: randomUUID() }),
        /session_mismatch/,
      );
      const wallet3 = await readyWallet();
      const row = await create(wallet3.id);
      await signedApprovals(row);
      const auth = (await details(row.id)).authorization;
      const session = randomUUID();
      const manifest = {
        session,
        walletId: wallet3.id,
        mode: 'sign',
        participants: ['signer-1', 'signer-2'],
        authorization: auth,
      };
      const { context } = await callSigner<{ context: string }>(
        'coordinator',
        'signer-1',
        '/prepare',
        manifest,
      );
      await assert.rejects(
        () =>
          callSigner('signer-3', 'signer-1', '/message', {
            session,
            context,
            sequence: 0,
            data: '00',
          }),
        /unauthorized_session_peer/,
      );
      await assert.rejects(
        () =>
          callSigner('signer-2', 'signer-1', '/message', {
            session,
            context: '00'.repeat(32),
            sequence: 0,
            data: '00',
          }),
        /session_context_mismatch/,
      );
      await callSigner('signer-2', 'signer-1', '/message', {
        session,
        context,
        sequence: 0,
        data: '00',
      });
      await assert.rejects(
        () =>
          callSigner('signer-2', 'signer-1', '/message', {
            session,
            context,
            sequence: 0,
            data: '00',
          }),
        /message_replay_or_order/,
      );
      await callSigner('coordinator', 'signer-1', '/cancel', { session });
      await assert.rejects(
        () => callSigner('coordinator', 'signer-1', '/prepare', manifest),
        /session_replay/,
      );
      const timeoutManifest = { ...manifest, session: randomUUID() };
      await Promise.all(
        ['signer-1', 'signer-2'].map((id) =>
          callSigner('coordinator', id, '/prepare', timeoutManifest),
        ),
      );
      const start = Date.now();
      await assert.rejects(() =>
        callSigner('coordinator', 'signer-1', '/run', { session: timeoutManifest.session }),
      );
      assert.ok(Date.now() - start >= 29000 && Date.now() - start < 35000);
      await callSigner('coordinator', 'signer-2', '/cancel', {
        session: timeoutManifest.session,
      }).catch(() => undefined);
      const finalManifest = { ...manifest, session: randomUUID() };
      await callSigner('coordinator', 'signer-1', '/prepare', finalManifest);
      await callSigner('coordinator', 'signer-1', '/cancel', { session: finalManifest.session });
      await assert.rejects(
        () =>
          callSigner('coordinator', 'signer-1', '/prepare', { ...manifest, session: randomUUID() }),
        /signer_retry_limit/,
      );
      await pool.query(
        "UPDATE transactions SET state='blocked',error='integration_timeout_check' WHERE id=$1",
        [row.id],
      );
    },
  );
  await check(
    'concurrent reservations and nonce allocation enforce aggregate spending limits',
    async () => {
      const w = await readyWallet();
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () => create(w.id, '1000000000000000000')),
      );
      const accepted = outcomes
        .filter((o) => o.status === 'fulfilled')
        .map((o) => (o as PromiseFulfilledResult<TxRow>).value);
      assert.equal(accepted.length, 9);
      assert.equal(new Set(accepted.map((r) => r.nonce)).size, 9);
      assert.deepEqual(
        accepted.map((r) => Number(r.nonce)).sort((a, b) => a - b),
        Array.from({ length: 9 }, (_, i) => i),
      );
      const reserved = (await pool.query('SELECT reserved FROM wallets WHERE id=$1', [w.id]))
        .rows[0].reserved;
      assert.ok(BigInt(reserved) < BigInt((await policy()).policy.aggregate));
    },
  );
  await check('expired approvals and transaction edits clear authorization', async () => {
    const w = await readyWallet();
    const row = await create(w.id);
    await approveAs('alice', row.id);
    await pool.query("UPDATE transactions SET expires_at=now()-interval '1 second' WHERE id=$1", [
      row.id,
    ]);
    await assert.rejects(() => approveAs('bob', row.id), /approval_expired/);
    await request('requester', '/transactions/' + row.id + '/reapprove', {
      walletId: w.id,
      recipient: (await policy()).policy.recipients[0],
      value: '5000000000000000',
    });
    const detail = await details(row.id);
    assert.notEqual(detail.authorization.digest, row.digest);
    assert.equal(detail.authorization.approvals.length, 0);
  });
  await check(
    'concurrent workers cannot own the same row; crashed owner is fenced after recovery',
    async () => {
      const w = await readyWallet();
      const row = await create(w.id);
      await signedApprovals(row);
      await sleep(1100);
      const claims = await Promise.all(Array.from({ length: 8 }, () => claim()));
      const own = claims.filter((r) => r?.id === row.id);
      assert.equal(own.length, 1);
      const lost = own[0]!;
      await pool.query(
        "UPDATE transactions SET lease_until=now()-interval '1 second' WHERE id=$1",
        [row.id],
      );
      stopProcess('node', 'SIGKILL');
      restartProcess('node', { QUORUM_NO_WORKER: '1' });
      await sleep(1100);
      // Recovery records the abandoned operation before allowing a new owner.
      await claim();
      await assert.rejects(
        () => fencedUpdate(lost, 'signed', { signed_raw: '0x', tx_hash: '0x' + '00'.repeat(32) }),
        /worker_ownership_lost/,
      );
      const recovered = (
        await pool.query('SELECT state,owner FROM transactions WHERE id=$1', [row.id])
      ).rows[0];
      assert.notEqual(recovered.owner, lost.owner);
      // A real API process crash/restart occurred; expire the new claim for the next check.
      await pool.query(
        "UPDATE transactions SET state='ready',owner=NULL,lease_until=NULL,updated_at=now()-interval '2 seconds' WHERE id=$1",
        [row.id],
      );
      tx = row;
    },
  );
  await check(
    'ambiguous broadcast after a real send and process crash recovers the persisted hash',
    async () => {
      const row = await ownClaim(tx.id);
      await processClaim(row);
      const persisted = (await pool.query('SELECT * FROM transactions WHERE id=$1', [tx.id]))
        .rows[0] as TxRow;
      assert.equal(persisted.state, 'signed');
      await chain.send('eth_sendRawTransaction', [persisted.signed_raw]);
      // Simulate process death before recording the response: persisted state remains signed.
      stopProcess('node', 'SIGKILL');
      restartProcess('node', { QUORUM_NO_WORKER: '1' });
      await sleep(1100);
      await processClaim(await ownClaim(tx.id));
      const done = (await pool.query('SELECT * FROM transactions WHERE id=$1', [tx.id])).rows[0];
      assert.equal(done.state, 'confirmed');
      assert.equal(done.tx_hash, persisted.tx_hash);
      assert.equal(done.broadcast_attempts, 0);
    },
  );
  await check(
    'policy updates invalidate approvals and each signer rejects old policy evidence',
    async () => {
      const w = await readyWallet();
      const row = await create(w.id);
      await signedApprovals(row);
      const old = (await details(row.id)).authorization;
      const current = await policy();
      const next = { ...current.policy, version: current.policy.version + 1 };
      const envelope = {
        policy: next,
        signature: sign(null, Buffer.from(policyText(next)), actor('admin').privateKey).toString(
          'hex',
        ),
      };
      await request('admin', '/policy', envelope);
      assert.equal((await details(row.id)).transaction.state, 'blocked');
      await assert.rejects(() => protocol('sign', w.id, old), /policy_changed/);
      await assert.rejects(
        () => callSigner('coordinator', 'signer-1', '/policy', current),
        /policy_rollback/,
      );
    },
  );
  await check(
    'expired authorization blocks persisted real MPC bytes before a new broadcast',
    async () => {
      const w = await readyWallet();
      const row = await create(w.id);
      await signedApprovals(row);
      await processClaim(await ownClaim(row.id));
      const signed = (await pool.query('SELECT * FROM transactions WHERE id=$1', [row.id]))
        .rows[0] as TxRow;
      assert.equal(signed.state, 'signed');
      assert.ok(signed.signed_raw && signed.tx_hash);
      await pool.query("UPDATE transactions SET expires_at=now()-interval '1 second' WHERE id=$1", [
        row.id,
      ]);
      await processClaim(await ownClaim(row.id));
      const blocked = (await pool.query('SELECT * FROM transactions WHERE id=$1', [row.id]))
        .rows[0] as TxRow;
      assert.equal(blocked.state, 'blocked');
      assert.equal(blocked.error, 'approval_expired');
      assert.equal(blocked.broadcast_attempts, 0);
      assert.equal(blocked.signed_raw, signed.signed_raw);
      assert.equal(blocked.reserved, signed.reserved);
      assert.equal(await chain.getTransaction(signed.tx_hash!), null);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM audit WHERE transaction_id=$1 AND event='broadcast_authorized'",
            [row.id],
          )
        ).rowCount,
        0,
      );
    },
  );
  await check('observed real transaction reconciles even after its approval expiry', async () => {
    const w = await readyWallet();
    const row = await create(w.id);
    await signedApprovals(row);
    await processClaim(await ownClaim(row.id));
    const signed = (await pool.query('SELECT * FROM transactions WHERE id=$1', [row.id]))
      .rows[0] as TxRow;
    assert.equal(signed.state, 'signed');
    assert.equal(await chain.send('eth_sendRawTransaction', [signed.signed_raw]), signed.tx_hash);
    await pool.query("UPDATE transactions SET expires_at=now()-interval '1 second' WHERE id=$1", [
      row.id,
    ]);
    await processClaim(await ownClaim(row.id));
    assert.equal((await details(row.id)).transaction.state, 'confirmed');
  });
  await check(
    'policy changed after real MPC signing blocks fresh submission of old bytes',
    async () => {
      const w = await readyWallet();
      const row = await create(w.id);
      await signedApprovals(row);
      await processClaim(await ownClaim(row.id));
      const signed = (await pool.query('SELECT * FROM transactions WHERE id=$1', [row.id]))
        .rows[0] as TxRow;
      assert.equal(signed.state, 'signed');
      const current = await policy();
      const next = { ...current.policy, version: current.policy.version + 1 };
      await request('admin', '/policy', {
        policy: next,
        signature: sign(null, Buffer.from(policyText(next)), actor('admin').privateKey).toString(
          'hex',
        ),
      });
      await processClaim(await ownClaim(row.id));
      const blocked = (await pool.query('SELECT * FROM transactions WHERE id=$1', [row.id]))
        .rows[0] as TxRow;
      assert.equal(blocked.state, 'blocked');
      assert.equal(blocked.error, 'policy_changed');
      assert.equal(blocked.broadcast_attempts, 0);
      assert.equal(blocked.tx_hash, signed.tx_hash);
      assert.equal(await chain.getTransaction(signed.tx_hash!), null);
    },
  );
  await check(
    'engineering evidence endpoints are admin-only and do not export runtime secrets',
    async () => {
      await assert.rejects(() => request('requester', '/compliance'), /role_forbidden/);
      await assert.rejects(() => request('alice', '/compliance/evidence'), /role_forbidden/);
      const inventory = await request<{ controls: { status: string }[] }>('admin', '/compliance');
      assert.ok(inventory.controls.length >= 10);
      assert.ok(inventory.controls.every((control) => control.status !== 'VERIFIED'));
      const exported = JSON.stringify(await request('admin', '/compliance/evidence'));
      for (const id of ['requester', 'alice', 'bob', 'admin']) {
        assert.ok(!exported.includes(actor(id).token));
        assert.ok(!exported.includes(actor(id).privateKey));
      }
      assert.ok(!exported.includes('signed_raw'));
      assert.ok(!exported.includes('.share'));
    },
  );
  await check('database audit modification is denied to application credentials', async () => {
    await assert.rejects(
      () => pool.query("UPDATE audit SET event='tampered'"),
      /permission denied/,
    );
    await assert.rejects(() => pool.query('DELETE FROM audit'), /permission denied/);
  });
  await check(
    'log redaction and API responses exclude actor secrets and encrypted keyshare bytes',
    async () => {
      const marker = 'sensitive-development-marker-' + randomUUID();
      await assert.rejects(
        () =>
          request(
            'requester',
            '/transactions',
            {
              walletId: wallet.id,
              recipient: config().policyEnvelope.policy.recipients[0],
              value: '1000',
              privateKey: marker,
            },
            'redaction-' + randomUUID(),
          ),
        /invalid_request/,
      );
      const response =
        JSON.stringify(await request('admin', '/overview')) +
        readFileSync(resolve(dev, 'api.log'), 'utf8');
      assert.ok(!response.includes(marker));
      for (const id of ['requester', 'alice', 'bob', 'admin']) {
        const a = actor(id);
        assert.ok(!response.includes(a.token));
        assert.ok(!response.includes(a.privateKey));
      }
      const source = readFileSync('src/api.ts', 'utf8');
      assert.ok(!source.includes('console.log(req'));
      assert.ok(!source.includes('console.log(error'));
      for (const id of ['signer-1', 'signer-2', 'signer-3'])
        assert.ok(
          !response.includes(readFileSync(resolve(dev, id, wallet.id + '.share')).toString('hex')),
        );
    },
  );
  console.log(`REAL INTEGRATION: ${passed} groups passed; no mocked crypto, database or chain.`);
} finally {
  stopProcess('node', 'SIGKILL');
  await sleep(100);
  restartProcess('node', { QUORUM_NO_WORKER: '0' });
  await pool.end();
  await chain.destroy();
}
