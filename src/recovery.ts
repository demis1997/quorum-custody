// Operator-only recovery. Never expose backup bytes or wrapping keys over HTTP.
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  readdirSync,
  lstatSync,
  existsSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { atomicJson, privateDir } from './config.js';
import { canonical, requireThat } from './domain.js';
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const allowed = new RegExp(
  `^(wrapping\\.key|policy\\.json|ledger\\.json|${uuid}\\.(share|public)|sessions/${uuid})$`,
);
const maxBytes = 32 * 1024 * 1024;
type Files = Record<string, string>;
type Anchor = { generation: number; digest: string };
export type RecoveryIdentity = { signer: string; fingerprint: string; trustContext: string };
function privateRead(path: string, max = maxBytes): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    requireThat(
      stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= max,
      'unsafe_recovery_file',
    );
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function snapshot(storage: string): Files {
  requireThat(
    lstatSync(storage).isDirectory() &&
      !lstatSync(storage).isSymbolicLink() &&
      (lstatSync(storage).mode & 0o077) === 0,
    'unsafe_recovery_directory',
  );
  const files: Files = {};
  let total = 0;
  const entries = readdirSync(storage)
    .flatMap((name) => {
      if (name !== 'sessions') return [name];
      const dir = resolve(storage, name);
      requireThat(
        lstatSync(dir).isDirectory() &&
          !lstatSync(dir).isSymbolicLink() &&
          (lstatSync(dir).mode & 0o077) === 0,
        'unsafe_recovery_directory',
      );
      return readdirSync(dir).map((child) => 'sessions/' + child);
    })
    .sort();
  requireThat(entries.length <= 4300, 'recovery_file_quota');
  for (const name of entries) {
    requireThat(allowed.test(name), 'unknown_recovery_file');
    const bytes = privateRead(resolve(storage, name), 4 * 1024 * 1024);
    total += bytes.length;
    requireThat(total <= maxBytes, 'recovery_size_limit');
    files[name] = bytes.toString('base64');
  }
  requireThat(
    Buffer.from(files['wrapping.key'] ?? '', 'base64').length === 32,
    'missing_wrapping_key',
  );
  return files;
}
function digest(files: Files) {
  return createHash('sha256').update(canonical(files)).digest('hex');
}
function anchorAt(path: string): Anchor {
  return z
    .object({ generation: z.number().int().positive(), digest: z.string().regex(/^[a-f0-9]{64}$/) })
    .strict()
    .parse(JSON.parse(privateRead(path, 4096).toString()));
}
export function verifyRecoveryState(storage: string, anchor: string) {
  const current = anchorAt(anchor);
  requireThat(current.digest === digest(snapshot(storage)), 'recovery_state_mismatch');
  return current;
}
export function checkpointRecovery(storage: string, anchor: string) {
  privateDir(dirname(anchor));
  const generation = existsSync(anchor) ? anchorAt(anchor).generation + 1 : 1;
  atomicJson(anchor, { generation, digest: digest(snapshot(storage)) });
}
export function initializeRecovery(storage: string, anchor: string) {
  requireThat(!existsSync(anchor + '.operator.lock'), 'recovery_operation_in_progress');
  if (existsSync(anchor)) verifyRecoveryState(storage, anchor);
  else {
    requireThat(
      !readdirSync(storage).some((name) => name.endsWith('.share')),
      'recovery_enrollment_required',
    );
    checkpointRecovery(storage, anchor);
  }
}
export function enrollRecovery(storage: string, anchor: string) {
  requireThat(!existsSync(anchor), 'recovery_already_enrolled');
  checkpointRecovery(storage, anchor);
}
export function recoveryStatus(storage: string, anchor: string) {
  const state = verifyRecoveryState(storage, anchor);
  return {
    generation: state.generation,
    wallets: readdirSync(storage).filter((n) => n.endsWith('.public')).length,
  };
}
export function readPassword(path: string) {
  const password = privateRead(path, 1024);
  requireThat(password.length >= 24, 'recovery_password_too_short');
  return password;
}
function derive(password: Buffer, salt: Buffer) {
  return scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
export function backupSigner(
  storage: string,
  anchor: string,
  identity: RecoveryIdentity,
  password: Buffer,
  output: string,
) {
  requireThat(password.length >= 24, 'recovery_password_too_short');
  const state = verifyRecoveryState(storage, anchor);
  const files = snapshot(storage);
  requireThat(digest(files) === state.digest, 'recovery_state_changed');
  const metadata = { format: 'quorum-signer-backup/v1', ...identity, ...state };
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = derive(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(canonical(metadata)));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(files)), cipher.final()]);
    const fd = openSync(
      output,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(
        fd,
        JSON.stringify({
          metadata,
          salt: salt.toString('hex'),
          iv: iv.toString('hex'),
          tag: cipher.getAuthTag().toString('hex'),
          ciphertext: ciphertext.toString('base64'),
        }),
      );
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const dir = openSync(dirname(resolve(output)), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return {
      generation: state.generation,
      wallets: Object.keys(files).filter((n) => n.endsWith('.public')).length,
    };
  } finally {
    key.fill(0);
  }
}
export function restoreSigner(
  storage: string,
  anchor: string,
  identity: RecoveryIdentity,
  password: Buffer,
  input: string,
) {
  requireThat(!existsSync(storage), 'restore_target_exists');
  const schema = z
    .object({
      metadata: z
        .object({
          format: z.literal('quorum-signer-backup/v1'),
          signer: z.string(),
          fingerprint: z.string(),
          trustContext: z.string(),
          generation: z.number().int().positive(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
      salt: z.string().regex(/^[a-f0-9]{32}$/),
      iv: z.string().regex(/^[a-f0-9]{24}$/),
      tag: z.string().regex(/^[a-f0-9]{32}$/),
      ciphertext: z
        .string()
        .max(maxBytes * 2)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict();
  const envelope = schema.parse(JSON.parse(privateRead(input, maxBytes * 2).toString()));
  requireThat(
    canonical(identity) ===
      canonical({
        signer: envelope.metadata.signer,
        fingerprint: envelope.metadata.fingerprint,
        trustContext: envelope.metadata.trustContext,
      }),
    'recovery_identity_mismatch',
  );
  const current = anchorAt(anchor);
  requireThat(
    current.generation === envelope.metadata.generation &&
      current.digest === envelope.metadata.digest,
    'stale_recovery_backup',
  );
  const key = derive(password, Buffer.from(envelope.salt, 'hex'));
  let plaintext: Buffer;
  try {
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
    cipher.setAAD(Buffer.from(canonical(envelope.metadata)));
    cipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
    try {
      plaintext = Buffer.concat([
        cipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        cipher.final(),
      ]);
    } catch {
      throw new Error('recovery_integrity_failed');
    }
  } finally {
    key.fill(0);
  }
  const files = z
    .record(
      z.string(),
      z
        .string()
        .max(6 * 1024 * 1024)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    )
    .parse(JSON.parse(plaintext.toString()));
  requireThat(
    Object.keys(files).length <= 4300 && Object.keys(files).every((n) => allowed.test(n)),
    'invalid_recovery_paths',
  );
  requireThat(
    digest(files) === current.digest &&
      Buffer.from(files['wrapping.key'] ?? '', 'base64').length === 32,
    'recovery_state_mismatch',
  );
  const restoredBytes = Object.values(files).map((value) => Buffer.from(value, 'base64').length);
  requireThat(
    restoredBytes.every((size) => size <= 4 * 1024 * 1024) &&
      restoredBytes.reduce((total, size) => total + size, 0) <= maxBytes,
    'recovery_size_limit',
  );
  const staging = storage + '.restore-' + randomBytes(8).toString('hex');
  mkdirSync(staging, { mode: 0o700 });
  privateDir(resolve(staging, 'sessions'));
  for (const [name, content] of Object.entries(files)) {
    const fd = openSync(resolve(staging, name), 'wx', 0o600);
    try {
      writeFileSync(fd, Buffer.from(content, 'base64'));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  for (const dir of [resolve(staging, 'sessions'), staging]) {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  // Publish a complete restored directory. Failed staging is retained for operator inspection.
  renameSync(staging, storage);
  const fd = openSync(dirname(storage), 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  verifyRecoveryState(storage, anchor);
  return recoveryStatus(storage, anchor);
}
