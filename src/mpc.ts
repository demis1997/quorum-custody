import { randomUUID } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1';
import { computeAddress, recoverAddress, Signature, Transaction } from 'ethers';
import { Authorization, requireThat } from './domain.js';
import { config } from './config.js';
import { callSigner } from './tls.js';
import { NativeResult } from './native.js';
export async function availability() {
  return Promise.all(
    config().signers.map(async (p) => {
      try {
        return await callSigner<{ id: string; available: boolean; policyVersion: number }>(
          'coordinator',
          p.id,
          '/health',
          undefined,
          1000,
        );
      } catch {
        return { id: p.id, available: false, policyVersion: null };
      }
    }),
  );
}
export async function protocol(
  mode: 'dkg' | 'sign',
  walletId: string,
  authorization?: Authorization,
  override?: string[],
) {
  const participants =
    override ??
    (mode === 'dkg'
      ? config().signers.map((s) => s.id)
      : (await availability())
          .filter((s) => s.available)
          .map((s) => s.id)
          .slice(0, 2));
  requireThat(participants.length >= (mode === 'dkg' ? 3 : 2), 'insufficient_quorum', 503);
  const manifest = {
    session: randomUUID(),
    walletId,
    mode,
    participants,
    ...(authorization ? { authorization } : {}),
  };
  try {
    // Await every preparation before cancellation: a late response must not create
    // an orphaned busy session after a different peer already rejected the quorum.
    const preparations = await Promise.allSettled(
      participants.map((p) =>
        callSigner<{ context: string }>('coordinator', p, '/prepare', manifest),
      ),
    );
    for (const preparation of preparations)
      if (preparation.status === 'rejected') throw preparation.reason;
    const prepared = preparations.map(
      (p) => (p as PromiseFulfilledResult<{ context: string }>).value,
    );
    requireThat(
      prepared.every((p) => p.context === prepared[0].context),
      'context_mismatch',
    );
    const outcomes = await Promise.allSettled(
      participants.map((p) =>
        callSigner<NativeResult>('coordinator', p, '/run', { session: manifest.session }),
      ),
    );
    for (const o of outcomes) if (o.status === 'rejected') throw o.reason;
    const results = outcomes.map((o) => (o as PromiseFulfilledResult<NativeResult>).value);
    requireThat(
      results.every((r) => r.publicKey === results[0].publicKey),
      'dkg_public_key_mismatch',
    );
    return results[0];
  } finally {
    await Promise.allSettled(
      participants.map((p) =>
        callSigner('coordinator', p, '/cancel', { session: manifest.session }, 1000),
      ),
    );
  }
}
export function signedTransaction(auth: Authorization, result: NativeResult) {
  requireThat(result.publicKey === auth.publicKey, 'signature_key_mismatch');
  const signature = secp256k1.Signature.fromDER(result.der);
  requireThat(
    secp256k1.verify(
      signature.toCompactRawBytes(),
      Buffer.from(auth.digest.slice(2), 'hex'),
      Buffer.from(auth.publicKey.slice(2), 'hex'),
      { lowS: false, prehash: false },
    ),
    'independent_verification_failed',
  );
  const normalized = signature.normalizeS();
  const expected = computeAddress(auth.publicKey);
  const rs = {
    r: '0x' + normalized.r.toString(16).padStart(64, '0'),
    s: '0x' + normalized.s.toString(16).padStart(64, '0'),
  };
  for (const yParity of [0, 1] as const) {
    const sig = Signature.from({ ...rs, yParity });
    if (recoverAddress(auth.digest, sig) === expected) {
      const tx = Transaction.from(auth.unsigned);
      tx.signature = sig;
      requireThat(tx.from === expected, 'recovered_sender_mismatch');
      return { raw: tx.serialized, hash: tx.hash! };
    }
  }
  throw new Error('signature_recovery_failed');
}
