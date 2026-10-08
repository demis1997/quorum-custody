import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { dev, config } from '../src/config.js';
import { stopProcess } from './processes.js';
const path = resolve(dev, 'processes.json');
if (existsSync(path)) {
  const processes = JSON.parse(readFileSync(path, 'utf8')) as {
    pid: number;
    command: string;
    started: number;
  }[];
  for (const p of processes) stopProcess(p.command);
  unlinkSync(path);
}
execFileSync(
  'docker',
  [
    'compose',
    '-p',
    config().project ?? 'quorum-custody',
    '--env-file',
    resolve(dev, 'compose.env'),
    'stop',
  ],
  { stdio: 'inherit' },
);
console.log(
  'Only Quorum project processes and Compose services stopped. Database volume retained.',
);
