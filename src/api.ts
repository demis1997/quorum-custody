import express from 'express';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config } from './config.js';
import { tokenHash, Rejection, requireThat } from './domain.js';
import { pool, policy, authorization, transaction, audit } from './db.js';
import { approve, createRequest, createWallet, updatePolicy, reapprove } from './custody.js';
import { availability } from './mpc.js';
import { demoEnabled, demoStatus, changeSigner } from './demo-controls.js';
import { startWorker } from './worker.js';
import { custodyControls, evidenceBundle } from './compliance.js';
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.get('/health', (_req, res) =>
  res.json({ status: 'prototype', network: 'local', chainId: 31337 }),
);
app.use('/api', (req, res, next) => {
  const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  const actor = bearer ? config().actors.find((a) => a.tokenHash === tokenHash(bearer)) : undefined;
  if (!actor) {
    res.status(401).json({ error: 'authentication_required' });
    return;
  }
  res.locals.actor = actor;
  next();
});
function roles(res: express.Response, ...allowed: string[]) {
  requireThat(allowed.includes(res.locals.actor.role), 'role_forbidden', 403);
  return res.locals.actor.id as string;
}
app.get('/api/overview', async (_req, res) => {
  const [wallets, transactions, signers, envelope] = await Promise.all([
    pool.query('SELECT * FROM wallets ORDER BY created_at DESC LIMIT 50'),
    pool.query(
      'SELECT id,wallet_id,requester,recipient,value,nonce,digest,policy_version,expires_at,state,sign_attempts,broadcast_attempts,tx_hash,error,created_at,updated_at FROM transactions ORDER BY created_at DESC LIMIT 100',
    ),
    availability(),
    policy(),
  ]);
  res.json({
    wallets: wallets.rows,
    transactions: transactions.rows,
    signers,
    policy: envelope.policy,
    demoControls: demoEnabled(),
    actor: { id: res.locals.actor.id, role: res.locals.actor.role },
  });
});
app.post('/api/wallets', async (_req, res) => res.json(await createWallet(roles(res, 'admin'))));
app.post('/api/transactions', async (req, res) =>
  res.json(
    await createRequest(
      roles(res, 'requester', 'approver'),
      req.get('Idempotency-Key') ?? '',
      req.body,
    ),
  ),
);
app.get('/api/transactions/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const row = (await pool.query('SELECT * FROM transactions WHERE id=$1', [id])).rows[0];
  requireThat(row, 'not_found', 404);
  const [auth, events] = await Promise.all([
    authorization(row),
    pool.query(
      'SELECT sequence,actor,event,details,created_at FROM audit WHERE transaction_id=$1 ORDER BY sequence',
      [id],
    ),
  ]);
  // Signed raw bytes and shares are never returned; exact unsigned bytes are reviewable.
  const { signed_raw: _raw, owner: _owner, lease_until: _lease, ...publicRow } = row;
  res.json({ transaction: publicRow, authorization: auth, timeline: events.rows });
});
app.post('/api/transactions/:id/approvals', async (req, res) =>
  res.json(
    await approve(
      z.string().uuid().parse(req.params.id),
      roles(res, 'approver'),
      z
        .object({ actor: z.string(), signature: z.string().length(128) })
        .strict()
        .parse(req.body),
    ),
  ),
);
app.post('/api/transactions/:id/reapprove', async (req, res) =>
  res.json(
    await reapprove(
      z.string().uuid().parse(req.params.id),
      roles(res, 'requester', 'approver'),
      req.body,
    ),
  ),
);
app.post('/api/policy', async (req, res) =>
  res.json(await updatePolicy(roles(res, 'admin'), req.body)),
);
app.get('/api/audit', async (_req, res) =>
  res.json(
    (
      await pool.query(
        'SELECT sequence,transaction_id,actor,event,details,created_at FROM audit ORDER BY sequence DESC LIMIT 100',
      )
    ).rows,
  ),
);
app.get('/api/compliance', async (_req, res) => {
  roles(res, 'admin');
  const envelope = await policy();
  res.json({
    controls: custodyControls,
    scope: 'Local ETH prototype · engineering evidence only',
    policyVersion: envelope.policy.version,
    frozen: envelope.policy.frozen ?? false,
  });
});
app.get('/api/compliance/evidence', (_req, res) => {
  roles(res, 'admin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', 'attachment; filename="quorum-engineering-evidence.json"');
  res.json(evidenceBundle());
});
app.get('/api/demo', async (_req, res) => {
  roles(res, 'admin');
  res.json(await demoStatus());
});
app.post('/api/demo/signers', async (req, res) => {
  res.json(await changeSigner(roles(res, 'admin'), req.body));
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
app.use(express.static(resolve('dist/ui')));
app.get('/', (_req, res) => res.sendFile(resolve('dist/ui/index.html')));
app.use(
  (error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const code =
      error instanceof Rejection
        ? error.code
        : error instanceof z.ZodError
          ? 'invalid_request'
          : 'operation_failed';
    // Logs have an allowlisted shape; no request bodies, headers, raw errors or protocol bytes.
    console.log(JSON.stringify({ event: 'request_rejected', code }));
    if (res.locals.actor && req.params.id && z.string().uuid().safeParse(req.params.id).success)
      void transaction((c) =>
        audit(c, res.locals.actor.id, 'request_rejected', req.params.id as string, {
          reason: code,
        }),
      ).catch(() => undefined);
    res.status(error instanceof Rejection ? error.status : 422).json({ error: code });
  },
);
const stop = process.env.QUORUM_NO_WORKER === '1' ? () => undefined : startWorker();
const server = app.listen(
  Number(process.env.PORT ?? 4300),
  process.env.QUORUM_BIND ?? '127.0.0.1',
  () => console.log(JSON.stringify({ event: 'api_started', network: 'local', chainId: 31337 })),
);
process.on('SIGTERM', () => {
  stop();
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
});
