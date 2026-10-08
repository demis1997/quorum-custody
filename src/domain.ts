import { canonical, approvalText } from './encoding.js';
export { canonical, binding, approvalText } from './encoding.js';
import { createHash, verify } from 'node:crypto';
import { Transaction, computeAddress, getAddress, keccak256 } from 'ethers';
import { z } from 'zod';

export class Rejection extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 422,
  ) {
    super(code);
  }
}
export function requireThat(ok: unknown, code: string, status = 422): asserts ok {
  if (!ok) throw new Rejection(code, status);
}
const wei = z.string().regex(/^[1-9][0-9]{0,23}$/);
export const requestSchema = z
  .object({ walletId: z.string().uuid(), recipient: z.string().length(42), value: wei })
  .strict();
export const policySchema = z
  .object({
    version: z.number().int().positive(),
    chainId: z.literal(31337),
    recipients: z.array(z.string().length(42)).min(1).max(20),
    perTransaction: wei,
    aggregate: wei,
    maxFeePerGas: wei,
    requiredApprovers: z.number().int().min(2).max(3),
    separationOfDuties: z.literal(true),
    frozen: z.boolean().optional(),
    deniedRecipients: z.array(z.string().length(42)).max(20).optional(),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export type PolicyEnvelope = { policy: Policy; signature: string };
export type ActorPublic = {
  id: string;
  role: 'requester' | 'approver' | 'admin';
  publicKey: string;
  tokenHash: string;
};
export type ApprovalBinding = {
  walletId: string;
  transactionId: string;
  digest: string;
  policyVersion: number;
  expiresAt: string;
  requester: string;
};
export type Approval = { actor: string; signature: string };
export type Authorization = ApprovalBinding & {
  unsigned: string;
  publicKey: string;
  approvals: Approval[];
  policyEnvelope: PolicyEnvelope;
};
const authorizationSchema = z
  .object({
    walletId: z.string().uuid(),
    transactionId: z.string().uuid(),
    requester: z.string().min(1).max(80),
    digest: z.string().regex(/^0x[a-f0-9]{64}$/),
    policyVersion: z.number().int().positive(),
    expiresAt: z.iso.datetime(),
    unsigned: z.string().max(1024),
    publicKey: z.string().regex(/^0x0[23][a-f0-9]{64}$/),
    approvals: z
      .array(
        z
          .object({
            actor: z.string().min(1).max(80),
            signature: z.string().regex(/^[a-f0-9]{128}$/),
          })
          .strict(),
      )
      .max(3),
    policyEnvelope: z
      .object({ policy: policySchema, signature: z.string().regex(/^[a-f0-9]{128}$/) })
      .strict(),
  })
  .strict();
export const states = [
  'awaiting_approvals',
  'ready',
  'signing',
  'signed',
  'broadcast',
  'confirmed',
  'blocked',
] as const;
export type State = (typeof states)[number];
const transitions: Record<State, readonly State[]> = {
  awaiting_approvals: ['ready', 'blocked'],
  ready: ['signing', 'blocked'],
  signing: ['ready', 'signed', 'blocked'],
  signed: ['broadcast', 'confirmed', 'blocked'],
  broadcast: ['confirmed', 'blocked'],
  confirmed: [],
  blocked: ['awaiting_approvals'],
};
export function transition(from: State, to: State) {
  requireThat(transitions[from].includes(to), 'invalid_transition');
}
export function policyText(policy: Policy) {
  return canonical({ domain: 'quorum-custody/policy/v1', policy });
}
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function verified(text: string, signature: string, publicKey: string) {
  try {
    return (
      /^[a-f0-9]{128}$/.test(signature) &&
      verify(null, Buffer.from(text), publicKey, Buffer.from(signature, 'hex'))
    );
  } catch {
    return false;
  }
}
export function validatePolicy(envelope: PolicyEnvelope, actors: ActorPublic[]) {
  const policy = policySchema.parse(envelope.policy);
  requireThat(
    [...policy.recipients, ...(policy.deniedRecipients ?? [])].every((a) => getAddress(a) === a),
    'invalid_policy_address',
  );
  requireThat(BigInt(policy.aggregate) >= BigInt(policy.perTransaction), 'invalid_limits');
  const admin = actors.find((a) => a.role === 'admin');
  requireThat(
    admin && verified(policyText(policy), envelope.signature, admin.publicKey),
    'invalid_policy_signature',
  );
  return policy;
}
export function parseTransfer(unsigned: string, policy: Policy) {
  requireThat(!policy.frozen, 'custody_frozen');
  requireThat(typeof unsigned === 'string' && unsigned.length <= 1024, 'transaction_bounds');
  let tx: Transaction;
  try {
    tx = Transaction.from(unsigned);
  } catch {
    throw new Rejection('invalid_transaction');
  }
  requireThat(!tx.signature && tx.unsignedSerialized === unsigned, 'noncanonical_unsigned');
  requireThat(
    tx.chainId === 31337n && policy.chainId === 31337 && tx.type === 2,
    'wrong_chain_or_type',
  );
  requireThat(tx.to && policy.recipients.includes(getAddress(tx.to)), 'recipient_not_allowed');
  requireThat(!policy.deniedRecipients?.includes(getAddress(tx.to)), 'recipient_denied');
  requireThat(tx.value > 0n && tx.value <= BigInt(policy.perTransaction), 'transaction_limit');
  requireThat(
    tx.data === '0x' && tx.gasLimit === 21000n && (tx.accessList?.length ?? 0) === 0,
    'eth_transfer_only',
  );
  requireThat(
    tx.nonce >= 0 &&
      tx.nonce < 1_000_000 &&
      tx.maxFeePerGas &&
      tx.maxPriorityFeePerGas &&
      tx.maxPriorityFeePerGas <= tx.maxFeePerGas &&
      tx.maxFeePerGas <= BigInt(policy.maxFeePerGas),
    'fee_or_nonce_bounds',
  );
  return tx;
}
export function validateApproval(
  auth: ApprovalBinding,
  approval: Approval,
  actors: ActorPublic[],
  policy: Policy,
  now = Date.now(),
) {
  requireThat(
    Date.parse(auth.expiresAt) > now && Date.parse(auth.expiresAt) <= now + 3_600_000,
    'approval_expired',
  );
  requireThat(auth.policyVersion === policy.version, 'policy_changed');
  const actor = actors.find((a) => a.id === approval.actor);
  requireThat(actor?.role === 'approver', 'not_approver');
  requireThat(!policy.separationOfDuties || approval.actor !== auth.requester, 'self_approval');
  requireThat(
    verified(approvalText(auth), approval.signature, actor.publicKey),
    'invalid_approval_signature',
  );
}
export function authorize(
  auth: Authorization,
  actors: ActorPublic[],
  currentPolicy: PolicyEnvelope,
  now = Date.now(),
) {
  authorizationSchema.parse(auth);
  const policy = validatePolicy(currentPolicy, actors);
  requireThat(canonical(auth.policyEnvelope) === canonical(currentPolicy), 'policy_changed');
  requireThat(
    actors.some(
      (a) => a.id === auth.requester && (a.role === 'requester' || a.role === 'approver'),
    ),
    'invalid_requester',
  );
  requireThat(
    z.string().uuid().safeParse(auth.walletId).success &&
      z.string().uuid().safeParse(auth.transactionId).success,
    'invalid_binding',
  );
  const tx = parseTransfer(auth.unsigned, policy);
  requireThat(
    keccak256(auth.unsigned) === auth.digest && tx.unsignedHash === auth.digest,
    'digest_mismatch',
  );
  requireThat(/^0x0[23][a-f0-9]{64}$/.test(auth.publicKey), 'invalid_public_key');
  requireThat(
    new Set(auth.approvals.map((a) => a.actor)).size === auth.approvals.length,
    'duplicate_approver',
  );
  requireThat(
    auth.approvals.length >= policy.requiredApprovers && auth.approvals.length <= 3,
    'insufficient_approvals',
  );
  for (const approval of auth.approvals) validateApproval(auth, approval, actors, policy, now);
  return {
    tx,
    address: computeAddress(auth.publicKey),
    reserved: tx.value + tx.gasLimit * tx.maxFeePerGas!,
  };
}
