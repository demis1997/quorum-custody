import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  chmodSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  backupSigner,
  restoreSigner,
  initializeRecovery,
  checkpointRecovery,
  verifyRecoveryState,
} from '../src/recovery.js';
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'quorum-recovery-test-'));
  const storage = resolve(root, 'signer'),
    anchor = resolve(root, 'anchors/one.json');
  mkdirSync(storage, { mode: 0o700 });
  writeFileSync(resolve(storage, 'wrapping.key'), randomBytes(32), { mode: 0o600 });
  writeFileSync(resolve(storage, 'ledger.json'), '{}', { mode: 0o600 });
  initializeRecovery(storage, anchor);
  return {
    root,
    storage,
    anchor,
    identity: {
      signer: 'signer-1',
      fingerprint: 'development-test',
      trustContext: 'synthetic-test-trust',
    },
    password: randomBytes(32),
  };
}
test('encrypted recovery preserves complete state and refuses overwriting live storage', () => {
  const f = fixture(),
    output = resolve(f.root, 'backup.qcb');
  const original = readFileSync(resolve(f.storage, 'wrapping.key'));
  backupSigner(f.storage, f.anchor, f.identity, f.password, output);
  assert.ok(!readFileSync(output).includes(original));
  assert.throws(
    () => restoreSigner(f.storage, f.anchor, f.identity, f.password, output),
    /restore_target_exists/,
  );
  renameSync(f.storage, f.storage + '.lost');
  restoreSigner(f.storage, f.anchor, f.identity, f.password, output);
  assert.deepEqual(readFileSync(resolve(f.storage, 'wrapping.key')), original);
  verifyRecoveryState(f.storage, f.anchor);
});
test('wrong password, ciphertext tampering and wrong identity fail before publishing files', () => {
  const f = fixture(),
    output = resolve(f.root, 'backup.qcb');
  backupSigner(f.storage, f.anchor, f.identity, f.password, output);
  renameSync(f.storage, f.storage + '.lost');
  assert.throws(
    () => restoreSigner(f.storage, f.anchor, f.identity, randomBytes(32), output),
    /recovery_integrity_failed/,
  );
  assert.throws(
    () =>
      restoreSigner(
        f.storage,
        f.anchor,
        { ...f.identity, fingerprint: 'other' },
        f.password,
        output,
      ),
    /recovery_identity_mismatch/,
  );
  const envelope = JSON.parse(readFileSync(output, 'utf8'));
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString('base64');
  writeFileSync(output, JSON.stringify(envelope));
  assert.throws(
    () => restoreSigner(f.storage, f.anchor, f.identity, f.password, output),
    /recovery_integrity_failed/,
  );
  assert.equal(existsSync(f.storage), false);
});
test('new persisted history invalidates a stale backup and state rollback blocks startup', () => {
  const f = fixture(),
    output = resolve(f.root, 'backup.qcb');
  backupSigner(f.storage, f.anchor, f.identity, f.password, output);
  writeFileSync(resolve(f.storage, 'ledger.json'), '{"new":"history"}');
  assert.throws(() => initializeRecovery(f.storage, f.anchor), /recovery_state_mismatch/);
  checkpointRecovery(f.storage, f.anchor);
  renameSync(f.storage, f.storage + '.lost');
  assert.throws(
    () => restoreSigner(f.storage, f.anchor, f.identity, f.password, output),
    /stale_recovery_backup/,
  );
});
test('permissive storage and symlinked backup inputs are rejected', () => {
  const f = fixture(),
    output = resolve(f.root, 'backup.qcb');
  chmodSync(resolve(f.storage, 'wrapping.key'), 0o644);
  assert.throws(
    () => backupSigner(f.storage, f.anchor, f.identity, f.password, output),
    /unsafe_recovery_file/,
  );
  chmodSync(resolve(f.storage, 'wrapping.key'), 0o600);
  backupSigner(f.storage, f.anchor, f.identity, f.password, output);
  renameSync(f.storage, f.storage + '.lost');
  const link = resolve(f.root, 'linked.qcb');
  symlinkSync(output, link);
  assert.throws(() => restoreSigner(f.storage, f.anchor, f.identity, f.password, link));
});
test('restore refuses a missing independent checkpoint', () => {
  const f = fixture(),
    output = resolve(f.root, 'backup.qcb');
  backupSigner(f.storage, f.anchor, f.identity, f.password, output);
  renameSync(f.storage, f.storage + '.lost');
  renameSync(f.anchor, f.anchor + '.lost');
  assert.throws(() => restoreSigner(f.storage, f.anchor, f.identity, f.password, output));
  assert.equal(existsSync(f.storage), false);
});
