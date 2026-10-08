import express from 'express';
import https from 'node:https';
import { TLSSocket } from 'node:tls';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config, dev, atomicJson, privateDir } from './config.js';
import {
  Authorization,
  PolicyEnvelope,
  authorize,
  canonical,
  requireThat,
  Rejection,
  validatePolicy,
} from './domain.js';
import { tlsOptions, peerIdentity, callSigner } from './tls.js';
import { runNative } from './native.js';
const identity = process.env.SIGNER_ID ?? 'signer-1';
requireThat(
  config().signers.some((p) => p.id === identity),
  'invalid_signer_identity',
);
const storage = resolve(dev, identity);
privateDir(storage);
const policyPath = resolve(storage, 'policy.json');
if (!existsSync(policyPath)) atomicJson(policyPath, config().policyEnvelope);
const ledgerPath = resolve(storage, 'ledger.json');
type Entry = { digest: string; reserved: string; nonce: number; attempts: number };
type Ledger = Record<string, Record<string, Entry>>;
const ledger: Ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
const currentPolicy = () => JSON.parse(readFileSync(policyPath, 'utf8')) as PolicyEnvelope;
const manifestSchema = z
  .object({
    session: z.string().uuid(),
    walletId: z.string().uuid(),
    mode: z.enum(['dkg', 'sign']),
    participants: z
      .array(z.enum(['signer-1', 'signer-2', 'signer-3']))
      .min(2)
      .max(3),
    authorization: z.unknown().optional(),
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
type Session = {
  manifest: Manifest;
  context: string;
  queues: Map<string, string[]>;
  waiters: Map<string, (value: string) => void>;
  incoming: Map<string, number>;
  outgoing: Map<string, number>;
  bytes: number;
  running: boolean;
  timer: NodeJS.Timeout;
};
let active: Session | undefined;
function clearSession(session: Session) {
  clearTimeout(session.timer);
  for (const wake of session.waiters.values()) wake('ERROR');
  session.waiters.clear();
  if (active === session) active = undefined;
}
function sessionFor(body: { session: string; context?: string }) {
  requireThat(active && active.manifest.session === body.session, 'session_mismatch', 409);
  if (body.context) requireThat(active.context === body.context, 'session_context_mismatch', 409);
  return active;
}
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '9mb' }));
app.use((req, res, next) => {
  try {
    res.locals.peer = peerIdentity(req.socket as TLSSocket);
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized_peer' });
  }
});
function coordinator(peer: string) {
  requireThat(peer === 'coordinator', 'coordinator_required', 403);
}
app.get('/health', (_req, res) =>
  res.json({ id: identity, available: !active, policyVersion: currentPolicy().policy.version }),
);
app.post('/policy', (req, res) => {
  coordinator(res.locals.peer);
  requireThat(!active, 'signer_busy', 409);
  const envelope = req.body as PolicyEnvelope;
  validatePolicy(envelope, config().actors);
  const current = currentPolicy();
  requireThat(
    envelope.policy.version > current.policy.version || canonical(envelope) === canonical(current),
    'policy_rollback',
    409,
  );
  atomicJson(policyPath, envelope);
  res.json({ version: envelope.policy.version });
});
app.post('/prepare', (req, res) => {
  coordinator(res.locals.peer);
  requireThat(!active, 'signer_busy', 409);
  const manifest = manifestSchema.parse(req.body);
  requireThat(
    manifest.participants.some((p) => p === identity) &&
      new Set(manifest.participants).size === manifest.participants.length &&
      manifest.participants.join(',') === [...manifest.participants].sort().join(','),
    'invalid_participants',
  );
  const seenPath = resolve(storage, 'sessions', manifest.session);
  privateDir(resolve(storage, 'sessions'));
  requireThat(!existsSync(seenPath), 'session_replay', 409);
  requireThat(readdirSync(resolve(storage, 'sessions')).length < 4096, 'development_session_quota');
  if (manifest.mode === 'dkg') {
    requireThat(
      readdirSync(storage).filter((name) => name.endsWith('.share')).length < 100,
      'development_wallet_quota',
    );
    requireThat(
      manifest.participants.length === 3 &&
        !existsSync(resolve(storage, manifest.walletId + '.share')),
      'invalid_dkg',
    );
  } else {
    const auth = manifest.authorization as Authorization;
    requireThat(auth?.walletId === manifest.walletId, 'wallet_mismatch');
    const decision = authorize(auth, config().actors, currentPolicy());
    const publicKey = readFileSync(resolve(storage, manifest.walletId + '.public'), 'utf8');
    requireThat(publicKey === auth.publicKey, 'wallet_public_key_mismatch');
    const entries = ledger[manifest.walletId] ?? {};
    const existing = entries[auth.transactionId];
    requireThat(!existing || existing.digest === auth.digest, 'transaction_changed');
    requireThat(
      !Object.entries(entries).some(
        ([id, e]) => id !== auth.transactionId && e.nonce === decision.tx.nonce,
      ),
      'nonce_conflict',
    );
    const total = Object.values(entries).reduce((n, e) => n + BigInt(e.reserved), 0n);
    requireThat(
      total + (existing ? 0n : decision.reserved) <= BigInt(currentPolicy().policy.aggregate),
      'signer_aggregate_limit',
    );
    requireThat(!existing || existing.attempts < 3, 'signer_retry_limit');
    entries[auth.transactionId] = {
      digest: auth.digest,
      reserved: decision.reserved.toString(),
      nonce: decision.tx.nonce,
      attempts: (existing?.attempts ?? 0) + 1,
    };
    ledger[manifest.walletId] = entries;
    atomicJson(ledgerPath, ledger);
  }
  writeFileSync(seenPath, 'prepared', { flag: 'wx', mode: 0o600 });
  const context = createHash('sha256').update(canonical(manifest)).digest('hex');
  const session: Session = {
    manifest,
    context,
    queues: new Map(),
    waiters: new Map(),
    incoming: new Map(),
    outgoing: new Map(),
    bytes: 0,
    running: false,
    timer: setTimeout(() => clearSession(session), 32000),
  };
  active = session;
  res.json({ context });
});
app.post('/message', (req, res) => {
  const body = z
    .object({
      session: z.string().uuid(),
      context: z.string().length(64),
      sequence: z.number().int().min(0).max(1024),
      data: z
        .string()
        .max(8_388_608)
        .regex(/^(?:[a-f0-9]{2})*$/),
    })
    .strict()
    .parse(req.body);
  const session = sessionFor(body);
  const sender = res.locals.peer as string;
  requireThat(
    sender !== identity && session.manifest.participants.some((p) => p === sender),
    'unauthorized_session_peer',
    403,
  );
  requireThat(
    body.sequence === (session.incoming.get(sender) ?? 0),
    'message_replay_or_order',
    409,
  );
  requireThat((session.bytes += body.data.length) <= 64_000_000, 'session_message_bounds');
  const queue = session.queues.get(sender) ?? [];
  requireThat(queue.length < 64, 'queue_bounds');
  session.incoming.set(sender, body.sequence + 1);
  const wake = session.waiters.get(sender);
  if (wake) {
    session.waiters.delete(sender);
    wake(body.data);
  } else {
    queue.push(body.data);
    session.queues.set(sender, queue);
  }
  res.json({ accepted: true });
});
app.post('/cancel', (req, res) => {
  coordinator(res.locals.peer);
  const session = sessionFor(req.body);
  clearSession(session);
  res.json({ cancelled: true });
});
app.post('/run', async (req, res) => {
  coordinator(res.locals.peer);
  const session = sessionFor(req.body);
  requireThat(!session.running, 'session_already_running', 409);
  session.running = true;
  const m = session.manifest;
  try {
    // Recheck expiry and current policy immediately before entering native signing.
    if (m.mode === 'sign')
      authorize(m.authorization as Authorization, config().actors, currentPolicy());
    const result = await runNative({
      mode: m.mode,
      identity,
      participants: m.participants,
      storage,
      walletId: m.walletId,
      digest: m.mode === 'sign' ? (m.authorization as Authorization).digest : '00'.repeat(32),
      send: async (to, data) => {
        requireThat(active === session, 'session_cancelled');
        const sequence = session.outgoing.get(to) ?? 0;
        await callSigner(
          identity,
          to,
          '/message',
          { session: m.session, context: session.context, sequence, data },
          5000,
        );
        session.outgoing.set(to, sequence + 1);
      },
      receive: async (from) => {
        requireThat(active === session, 'session_cancelled');
        const queue = session.queues.get(from);
        if (queue?.length) return queue.shift()!;
        return new Promise<string>((resolveReceive) => session.waiters.set(from, resolveReceive));
      },
    });
    requireThat(active === session, 'session_cancelled');
    if (m.mode === 'dkg')
      writeFileSync(resolve(storage, m.walletId + '.public'), result.publicKey, {
        flag: 'wx',
        mode: 0o600,
      });
    res.json(result);
  } finally {
    clearSession(session);
  }
});
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const code =
      error instanceof Rejection
        ? error.code
        : error instanceof z.ZodError
          ? 'invalid_request'
          : 'signer_internal_failure';
    res.status(error instanceof Rejection ? error.status : 422).json({ error: code });
  },
);
const port = Number(new URL(config().signers.find((p) => p.id === identity)!.url).port);
https
  .createServer({ ...tlsOptions(identity), requestCert: true, rejectUnauthorized: true }, app)
  .listen(port, process.env.QUORUM_BIND ?? '127.0.0.1', () =>
    console.log(JSON.stringify({ event: 'signer_started', id: identity, port })),
  );
