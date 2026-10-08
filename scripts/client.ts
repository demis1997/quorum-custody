import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sign } from 'node:crypto';
import { dev, config } from '../src/config.js';
import { approvalText, ApprovalBinding } from '../src/domain.js';
import { setTimeout as sleep } from 'node:timers/promises';
export type Actor = { id: string; token: string; privateKey: string; role: string };
export function actor(id: string): Actor {
  return JSON.parse(readFileSync(resolve(dev, 'actors', id + '.json'), 'utf8'));
}
export async function request<T = Record<string, unknown>>(
  id: string,
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const a = actor(id);
  const res = await fetch(`http://127.0.0.1:${config().ports?.api ?? 4300}/api` + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + a.token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error);
  return value;
}
export async function approveAs(id: string, transactionId: string) {
  const detail = await request<{ authorization: ApprovalBinding }>(
    id,
    '/transactions/' + transactionId,
  );
  const signature = sign(
    null,
    Buffer.from(approvalText(detail.authorization)),
    actor(id).privateKey,
  ).toString('hex');
  return request(id, '/transactions/' + transactionId + '/approvals', { actor: id, signature });
}
export async function waitForState(id: string, state: string, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const detail = await request<{
      transaction: { state: string; error: string | null; tx_hash: string | null };
    }>('admin', '/transactions/' + id);
    if (detail.transaction.state === state) return detail.transaction;
    if (detail.transaction.state === 'blocked')
      throw new Error(detail.transaction.error ?? 'blocked');
    await sleep(300);
  }
  throw new Error('state_timeout');
}
