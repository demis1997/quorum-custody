import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { ActorPublic, PolicyEnvelope } from './domain.js';
export const dev = resolve(process.env.QUORUM_DEV ?? '.dev');
export type Config = {
  demoControls?: boolean;
  project?: string;
  ports?: { api: number; chain: number; database: number };
  actors: ActorPublic[];
  signers: { id: string; url: string; fingerprint: string }[];
  coordinatorFingerprint: string;
  databaseUrl: string;
  rpcUrl: string;
  policyEnvelope: PolicyEnvelope;
};
let loadedConfig: Config | undefined;
export function config(): Config {
  return (loadedConfig ??= JSON.parse(readFileSync(resolve(dev, 'config.json'), 'utf8')) as Config);
}
export function atomicJson(path: string, value: unknown) {
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dirFd = openSync(resolve(path, '..'), 'r');
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}
export function privateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}
