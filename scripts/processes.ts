import { spawn } from 'node:child_process';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev, config, atomicJson } from '../src/config.js';
export type ProcessRecord = { pid: number; command: string; started: number };
const manifest = resolve(dev, 'processes.json');
export function processes(): ProcessRecord[] {
  return JSON.parse(readFileSync(manifest, 'utf8'));
}
export function stopProcess(command: string, signal: NodeJS.Signals = 'SIGTERM') {
  const p = processes().find((p) => p.command === command);
  if (!p) throw new Error('unmanaged_process');
  // Manifest is local private state written by start.ts, never supplied over HTTP.
  // Refuse a stale manifest instead of risking a reused PID after a long absence.
  if (Date.now() - p.started > 12 * 3600_000)
    throw new Error('stale_process_manifest_manual_cleanup_required');
  try {
    process.kill(p.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}
export function restartProcess(command: string, extra: NodeJS.ProcessEnv = {}) {
  const args =
    command === 'node' ? ['--import', 'tsx', 'src/api.ts'] : ['--import', 'tsx', 'src/signer.ts'];
  const logFd = openSync(
    resolve(dev, command === 'node' ? 'api.log' : command + '.log'),
    'a',
    0o600,
  );
  const child = spawn('node', args, {
    env: {
      ...process.env,
      PORT: String(config().ports?.api ?? 4300),
      ...extra,
      ...(command === 'node' ? {} : { SIGNER_ID: command }),
    },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });
  closeSync(logFd);
  if (!child.pid) throw new Error('spawn_failed');
  child.unref();
  const records = processes();
  const entry = records.find((p) => p.command === command)!;
  entry.pid = child.pid;
  entry.started = Date.now();
  atomicJson(manifest, records);
}
