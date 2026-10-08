import { existsSync, readFileSync, readdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config, dev, privateDir } from '../src/config.js';
import { canonical, requireThat } from '../src/domain.js';
import { callSigner } from '../src/tls.js';
import {
  backupSigner,
  restoreSigner,
  enrollRecovery,
  readPassword,
  recoveryStatus,
  type RecoveryIdentity,
} from '../src/recovery.js';
import { processes } from './processes.js';
export function recoveryIdentity(id: string): RecoveryIdentity {
  const cfg = config();
  const signer = cfg.signers.find((s) => s.id === id);
  requireThat(signer, 'unknown_signer');
  return {
    signer: id,
    fingerprint: signer.fingerprint,
    trustContext: createHash('sha256')
      .update(
        canonical({
          signers: cfg.signers.map((s) => ({ id: s.id, fingerprint: s.fingerprint })),
          actors: cfg.actors.map((a) => ({ id: a.id, role: a.role, publicKey: a.publicKey })),
          coordinator: cfg.coordinatorFingerprint,
        }),
      )
      .digest('hex'),
  };
}
export async function requireOffline(id: string) {
  if (existsSync(resolve(dev, 'processes.json'))) {
    const entry = processes().find((p) => p.command === id);
    requireThat(entry, 'unmanaged_process');
    try {
      process.kill(entry.pid, 0);
      throw new Error('signer_must_be_offline');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  let online = false;
  try {
    await callSigner('coordinator', id, '/health', undefined, 1000);
    online = true;
  } catch {}
  // Refuse both a live managed PID and a reachable pinned TLS service.
  requireThat(!online, 'signer_must_be_offline');
}
async function recoveryCommand(command: string, id: string, file?: string) {
  z.enum(['signer-1', 'signer-2', 'signer-3']).parse(id);
  await requireOffline(id);
  const storage = resolve(dev, id),
    anchor = resolve(dev, 'recovery', id + '.anchor.json');
  if (command === 'enroll') {
    enrollRecovery(storage, anchor);
    return { enrolled: id };
  }
  if (command === 'inspect') {
    const status = recoveryStatus(storage, anchor);
    const inventory = readdirSync(storage)
      .filter((n) => n.endsWith('.public'))
      .map((n) => ({
        walletId: n.slice(0, -7),
        publicKey: readFileSync(resolve(storage, n), 'utf8'),
        hasShare: existsSync(resolve(storage, n.slice(0, -7) + '.share')),
      }));
    const { pool } = await import('../src/db.js');
    try {
      const registered = new Set(
        (await pool.query('SELECT id FROM wallets')).rows.map((w) => w.id),
      );
      return {
        signer: id,
        ...status,
        inventory: inventory.map((w) => ({ ...w, orphaned: !registered.has(w.walletId) })),
      };
    } finally {
      await pool.end();
    }
  }
  requireThat(command === 'backup' || command === 'restore', 'invalid_recovery_command');
  requireThat(
    file && process.env.QUORUM_RECOVERY_PASSWORD_FILE,
    'recovery_file_and_password_required',
  );
  const password = readPassword(resolve(process.env.QUORUM_RECOVERY_PASSWORD_FILE));
  try {
    return command === 'backup'
      ? backupSigner(storage, anchor, recoveryIdentity(id), password, resolve(file))
      : restoreSigner(storage, anchor, recoveryIdentity(id), password, resolve(file));
  } finally {
    password.fill(0);
  }
}
export async function runRecovery(command: string, id: string, file?: string) {
  z.enum(['signer-1', 'signer-2', 'signer-3']).parse(id);
  privateDir(resolve(dev, 'recovery'));
  const lock = resolve(dev, 'recovery', id + '.anchor.json.operator.lock');
  const fd = openSync(lock, 'wx', 0o600);
  closeSync(fd);
  try {
    return await recoveryCommand(command, id, file);
  } finally {
    unlinkSync(lock);
  }
}
// Importable by real resilience tests without executing the command line.
if (process.argv[1]?.endsWith('/recovery.ts') || process.argv[1]?.endsWith('/recovery.js')) {
  try {
    console.log(
      JSON.stringify(await runRecovery(process.argv[2], process.argv[3], process.argv[4])),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'recovery_failed');
    process.exitCode = 1;
  }
}
