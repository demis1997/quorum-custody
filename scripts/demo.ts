import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { Transaction, JsonRpcProvider } from 'ethers';
import { dev, config, atomicJson } from '../src/config.js';
import { request, approveAs, waitForState } from './client.js';
import { authorize } from '../src/domain.js';
import { protocol } from '../src/mpc.js';
const chain = new JsonRpcProvider(config().rpcUrl);
const wallet = await request<{ id: string; address: string }>('admin', '/wallets', {});
await chain.send('anvil_setBalance', [wallet.address, '0x8ac7230489e80000']);
console.log('PASS real distributed wallet creation:', wallet.address);
const tx = await request<{ id: string }>(
  'requester',
  '/transactions',
  {
    walletId: wallet.id,
    recipient: config().policyEnvelope.policy.recipients[0],
    value: '10000000000000000',
  },
  'demo-' + randomUUID(),
);
await approveAs('alice', tx.id);
const detail = await request<{ authorization: Parameters<typeof authorize>[0] }>(
  'admin',
  '/transactions/' + tx.id,
);
try {
  authorize(detail.authorization, config().actors, detail.authorization.policyEnvelope);
  throw new Error('unexpected_authorization');
} catch (e) {
  if ((e as Error).message !== 'insufficient_approvals') throw e;
  console.log('PASS insufficient approvals rejected');
}
const processes = JSON.parse(readFileSync(resolve(dev, 'processes.json'), 'utf8')) as {
  pid: number;
  command: string;
  started: number;
}[];
const third = processes.find((p) => p.command === 'signer-3')!;
process.kill(third.pid, 'SIGTERM');
await sleep(700);
try {
  await approveAs('bob', tx.id);
  const completed = await waitForState(tx.id, 'confirmed');
  const receipt = await chain.getTransactionReceipt(completed.tx_hash!);
  if (receipt?.status !== 1) throw new Error('receipt_failure');
  console.log(
    'PASS real threshold signing with signer-3 OFFLINE, broadcast and local receipt:',
    completed.tx_hash,
  );
  const full = await request<{ authorization: Parameters<typeof authorize>[0] }>(
    'admin',
    '/transactions/' + tx.id,
  );
  const altered = Transaction.from(full.authorization.unsigned);
  altered.value += 1n;
  try {
    await protocol('sign', wallet.id, {
      ...full.authorization,
      unsigned: altered.unsignedSerialized,
    });
    throw new Error('mutation_accepted');
  } catch (e) {
    if ((e as Error).message !== 'digest_mismatch') throw e;
    console.log('PASS signer rejected altered transaction after approval');
  }
  try {
    await protocol('sign', wallet.id, full.authorization, ['signer-1']);
    throw new Error('quorum_accepted');
  } catch (e) {
    if ((e as Error).message !== 'insufficient_quorum') throw e;
    console.log('PASS insufficient quorum rejected');
  }
  atomicJson(resolve(dev, 'demo.json'), {
    walletId: wallet.id,
    address: wallet.address,
    transactionId: tx.id,
    hash: completed.tx_hash,
  });
} finally {
  const child = spawn('node', ['--import', 'tsx', 'src/signer.ts'], {
    env: { ...process.env, SIGNER_ID: 'signer-3' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  third.pid = child.pid!;
  third.started = Date.now();
  atomicJson(resolve(dev, 'processes.json'), processes);
}
// Leave a real pending approval request for dashboard review.
const pending = await request<{ id: string }>(
  'requester',
  '/transactions',
  {
    walletId: wallet.id,
    recipient: config().policyEnvelope.policy.recipients[0],
    value: '25000000000000000',
  },
  'queue-' + randomUUID(),
);
await approveAs('alice', pending.id);
atomicJson(resolve(dev, 'demo.json'), {
  ...JSON.parse(readFileSync(resolve(dev, 'demo.json'), 'utf8')),
  pendingId: pending.id,
});
writeFileSync(resolve(dev, 'pending-id'), pending.id, { mode: 0o600 });
console.log('Real pending approval request retained:', pending.id);
await chain.destroy();
