import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev, config, atomicJson } from '../src/config.js';
import { setTimeout as sleep } from 'node:timers/promises';
const pidPath = resolve(dev, 'processes.json');
if (existsSync(pidPath))
  throw new Error('Existing process manifest; run make stop before starting again.');
execFileSync(
  'docker',
  [
    'compose',
    '-p',
    config().project ?? 'quorum-custody',
    '--env-file',
    resolve(dev, 'compose.env'),
    'up',
    '-d',
    '--wait',
  ],
  {
    stdio: 'inherit',
  },
);
execFileSync('node', ['--import', 'tsx', 'scripts/migrate.ts'], { stdio: 'inherit' });
const processes: { pid: number; command: string; started: number }[] = [];
function launch(command: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const log = resolve(
    dev,
    command === 'anvil' ? 'anvil.log' : env.SIGNER_ID ? env.SIGNER_ID + '.log' : 'api.log',
  );
  // Logs are private and local. Anvil receives no mnemonic and emits no startup accounts.
  const logFd = openSync(log, 'a', 0o600);
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });
  closeSync(logFd);
  requirePid(child.pid);
  processes.push({ pid: child.pid, command: env.SIGNER_ID ?? command, started: Date.now() });
  child.unref();
  writeFileSync(log, 'Process started; use application audit for decisions.\n', { mode: 0o600 });
}
function requirePid(pid: number | undefined): asserts pid is number {
  if (!pid) throw new Error('spawn_failed');
}
try {
  launch('anvil', [
    '--host',
    '127.0.0.1',
    '--port',
    String(config().ports?.chain ?? 48545),
    '--chain-id',
    '31337',
    '--silent',
  ]);
  for (const id of ['signer-1', 'signer-2', 'signer-3'])
    launch('node', ['--import', 'tsx', 'src/signer.ts'], { SIGNER_ID: id });
  launch('node', ['--import', 'tsx', 'src/api.ts'], { PORT: String(config().ports?.api ?? 4300) });
  atomicJson(pidPath, processes);
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${config().ports?.api ?? 4300}/health`);
      if (res.ok) {
        console.log(`Dashboard available at http://127.0.0.1:${config().ports?.api ?? 4300}`);
        process.exit(0);
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('api_start_timeout');
} catch (error) {
  atomicJson(pidPath, processes);
  throw error;
}
