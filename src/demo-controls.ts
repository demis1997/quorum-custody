import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config, dev } from './config.js';
import { requireThat } from './domain.js';
import { callSigner } from './tls.js';
import { pool, transaction, audit } from './db.js';
import { stopProcess, restartProcess, processes } from '../scripts/processes.js';
import { recoveryStatus } from './recovery.js';
export function demoEnabled() {
  return config().demoControls === true && (process.env.QUORUM_BIND ?? '127.0.0.1') === '127.0.0.1';
}
let changing = false;
export async function changeSigner(actor: string, input: unknown) {
  requireThat(demoEnabled(), 'demo_controls_disabled', 404);
  const command = z
    .object({
      signer: z.enum(['signer-1', 'signer-2', 'signer-3']),
      action: z.enum(['offline', 'online']),
    })
    .strict()
    .parse(input);
  requireThat(!changing, 'demo_control_busy', 409);
  changing = true;
  try {
    await transaction((c) =>
      audit(c, actor, 'development_signer_control_requested', null, command),
    );
    const entry = processes().find((p) => p.command === command.signer);
    requireThat(entry, 'unmanaged_process');
    let alive = false;
    try {
      process.kill(entry.pid, 0);
      alive = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
    if (command.action === 'offline' && alive) {
      stopProcess(command.signer);
      let exited = false;
      for (let n = 0; n < 50; n++) {
        await sleep(100);
        try {
          process.kill(entry.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
            exited = true;
            break;
          }
          throw error;
        }
      }
      requireThat(exited, 'signer_stop_timeout', 503);
    }
    if (command.action === 'online' && !alive) {
      restartProcess(command.signer);
      let ready = false;
      for (let n = 0; n < 30; n++) {
        try {
          await callSigner('coordinator', command.signer, '/health', undefined, 500);
          ready = true;
          break;
        } catch {}
        await sleep(100);
      }
      requireThat(ready, 'signer_start_timeout', 503);
    }
    await transaction((c) => audit(c, actor, 'development_signer_control', null, command));
    return { signer: command.signer, action: command.action };
  } catch (error) {
    await transaction((c) =>
      audit(c, actor, 'development_signer_control_failed', null, {
        ...command,
        reason: 'control_failed',
      }),
    ).catch(() => undefined);
    throw error;
  } finally {
    changing = false;
  }
}
export async function demoStatus() {
  requireThat(demoEnabled(), 'demo_controls_disabled', 404);
  const signers = await Promise.all(
    config().signers.map(async (signer) => {
      try {
        const health = await callSigner<{ available: boolean; policyVersion: number }>(
          'coordinator',
          signer.id,
          '/health',
          undefined,
          1000,
        );
        return { id: signer.id, online: true, ...health };
      } catch {
        return { id: signer.id, online: false, available: false, policyVersion: null };
      }
    }),
  );
  const jobs = (
    await pool.query(
      'SELECT id,state,owner,lease_until,sign_attempts,broadcast_attempts,error,tx_hash FROM transactions ORDER BY updated_at DESC LIMIT 20',
    )
  ).rows;
  const recovery = config().signers.map((s) => {
    // Do not scan files while a signer may be writing them. Online state is not a consistent backup.
    if (signers.find((peer) => peer.id === s.id)?.online)
      return { id: s.id, status: 'stop_signer_to_inspect' };
    try {
      return {
        id: s.id,
        status: 'verified',
        ...recoveryStatus(resolve(dev, s.id), resolve(dev, 'recovery', s.id + '.anchor.json')),
      };
    } catch {
      return { id: s.id, status: 'inspection_required' };
    }
  });
  return { signers, jobs, recovery };
}
