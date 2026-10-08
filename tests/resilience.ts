// Real cb-mpc, PostgreSQL, managed processes and Anvil; no crypto/RPC mocks.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JsonRpcProvider } from 'ethers';
import { config, dev } from '../src/config.js';
import { pool, policy } from '../src/db.js';
import { protocol } from '../src/mpc.js';
import { callSigner } from '../src/tls.js';
import { request, approveAs, waitForState } from '../scripts/client.js';
import { runRecovery } from '../scripts/recovery.js';
const chain = new JsonRpcProvider(config().rpcUrl);
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log('PASS ' + name);
  passed++;
}
async function control(signer: string, action: string) {
  return request('admin', '/demo/signers', { signer, action });
}
const dir = resolve(dev, 'backups');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const password = resolve(dir, 'test-password');
writeFileSync(password, randomBytes(32), { mode: 0o600 });
process.env.QUORUM_RECOVERY_PASSWORD_FILE = password;
const storage = resolve(dev, 'signer-2'),
  lost = resolve(dev, 'signer-2.simulated-loss-' + randomUUID());
try {
  await check(
    'development fault controls require admin and fixed managed signer identities',
    async () => {
      await assert.rejects(() => request('requester', '/demo'), /role_forbidden/);
      await assert.rejects(
        () => request('requester', '/demo/signers', { signer: 'signer-1', action: 'offline' }),
        /role_forbidden/,
      );
      await assert.rejects(() => control('../../node', 'offline'), /invalid_request/);
      await assert.rejects(
        () => runRecovery('backup', 'signer-2', resolve(dir, 'online.qcb')),
        /signer_must_be_offline/,
      );
    },
  );
  const wallet = await request<{ id: string; address: string }>('admin', '/wallets', {});
  await chain.send('anvil_setBalance', [wallet.address, '0x8ac7230489e80000']);
  const orphan = randomUUID();
  await protocol('dkg', orphan);
  async function transfer() {
    const envelope = await policy();
    const tx = await request<{ id: string }>(
      'requester',
      '/transactions',
      { walletId: wallet.id, recipient: envelope.policy.recipients[0], value: '1000000000000000' },
      'resilience-' + randomUUID(),
    );
    await approveAs('alice', tx.id);
    await approveAs('bob', tx.id);
    const done = await waitForState(tx.id, 'confirmed');
    assert.equal((await chain.getTransactionReceipt(done.tx_hash!))?.status, 1);
    return tx.id;
  }
  await check(
    'admin takes a real signer offline; an approved transfer confirms with the remaining quorum',
    async () => {
      await control('signer-3', 'offline');
      const status = await request<{ signers: { id: string; online: boolean }[] }>(
        'admin',
        '/demo',
      );
      assert.equal(status.signers.find((s) => s.id === 'signer-3')?.online, false);
      await transfer();
      await control('signer-3', 'online');
    },
  );
  const old = resolve(dir, 'old.qcb'),
    current = resolve(dir, 'current.qcb');
  await control('signer-2', 'offline');
  await check(
    'operator inventory reports real orphaned DKG state without exporting share material',
    async () => {
      const result = JSON.parse(
        execFileSync('node', ['--import', 'tsx', 'scripts/recovery.ts', 'inspect', 'signer-2'], {
          encoding: 'utf8',
        }),
      );
      assert.equal(
        result.inventory.find((w: { walletId: string }) => w.walletId === orphan)?.orphaned,
        true,
      );
      assert.ok(
        !JSON.stringify(result).includes(
          readFileSync(resolve(storage, 'wrapping.key')).toString('base64'),
        ),
      );
    },
  );
  await runRecovery('backup', 'signer-2', old);
  await control('signer-2', 'online');
  await control('signer-3', 'offline');
  await transfer(); // Advance signer-2's local ledger and independent checkpoint.
  await control('signer-3', 'online');
  await control('signer-2', 'offline');
  await runRecovery('backup', 'signer-2', current);
  const beforeLedger = readFileSync(resolve(storage, 'ledger.json'));
  const beforeSessions = readdirSync(resolve(storage, 'sessions')).sort();
  renameSync(storage, lost); // Controlled directory-loss injection; original retained privately.
  await check(
    'a backup preceding signing history is rejected against the retained checkpoint',
    async () => {
      await assert.rejects(() => runRecovery('restore', 'signer-2', old), /stale_recovery_backup/);
      assert.equal(existsSync(storage), false);
    },
  );
  await check(
    'latest encrypted backup restores complete signer history and original public identity',
    async () => {
      await runRecovery('restore', 'signer-2', current);
      assert.deepEqual(readFileSync(resolve(storage, 'ledger.json')), beforeLedger);
      assert.deepEqual(readdirSync(resolve(storage, 'sessions')).sort(), beforeSessions);
      const pub = (await pool.query('SELECT public_key FROM wallets WHERE id=$1', [wallet.id]))
        .rows[0].public_key;
      assert.equal(readFileSync(resolve(storage, wallet.id + '.public'), 'utf8'), pub);
      await assert.rejects(
        () => runRecovery('restore', 'signer-2', current),
        /restore_target_exists/,
      );
      await control('signer-2', 'online');
    },
  );
  await check(
    'restored signer participates in real signing; old session IDs remain rejected',
    async () => {
      await control('signer-3', 'offline');
      const id = await transfer();
      const details = await request<{ authorization: unknown }>('admin', '/transactions/' + id);
      await assert.rejects(
        () =>
          callSigner('coordinator', 'signer-2', '/prepare', {
            mode: 'sign',
            walletId: wallet.id,
            session: beforeSessions[0],
            participants: ['signer-1', 'signer-2'],
            authorization: details.authorization,
          }),
        /session_replay/,
      );
      const reservedBefore = Object.values(
        JSON.parse(beforeLedger.toString())[wallet.id] as Record<string, { reserved: string }>,
      ).reduce((sum, entry) => sum + BigInt(entry.reserved), 0n);
      const reservedAfter = Object.values(
        JSON.parse(readFileSync(resolve(storage, 'ledger.json'), 'utf8'))[wallet.id] as Record<
          string,
          { reserved: string }
        >,
      ).reduce((sum, entry) => sum + BigInt(entry.reserved), 0n);
      assert.ok(reservedAfter > reservedBefore);
      await control('signer-3', 'online');
    },
  );
  const events = (
    await pool.query(
      "SELECT count(*)::int AS count FROM audit WHERE event='development_signer_control'",
    )
  ).rows[0].count;
  assert.ok(events >= 10);
  console.log(
    `REAL RESILIENCE: ${passed} groups passed; actual offline quorum and encrypted restore.`,
  );
} finally {
  if (!existsSync(storage) && existsSync(lost)) renameSync(lost, storage);
  for (const signer of ['signer-2', 'signer-3'])
    await control(signer, 'online').catch(() => undefined);
  await pool.end();
  await chain.destroy();
}
