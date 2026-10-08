import { Transaction, computeAddress } from 'ethers';
import { z } from 'zod';
import {
  authorize,
  requireThat,
  Rejection,
  type Authorization,
  type ActorPublic,
  type PolicyEnvelope,
} from './domain.js';

export type BroadcastCandidate = {
  state: string;
  signed_raw: string | null;
  tx_hash: string | null;
  unsigned: string;
  broadcast_attempts: number;
};

// Pure validation shared by the database decision boundary and cryptographic tests.
// No RPC is sent and no MPC signature is generated here.
export function validateBroadcastDecision(
  row: BroadcastCandidate,
  auth: Authorization,
  actors: ActorPublic[],
  envelope: PolicyEnvelope,
  now = Date.now(),
) {
  requireThat(row.state === 'signed' || row.state === 'broadcast', 'invalid_broadcast_state');
  requireThat(row.broadcast_attempts < 5, 'broadcast_retry_limit_reconcile_manually');
  requireThat(row.signed_raw && row.tx_hash, 'missing_signed_transaction');
  let tx: Transaction;
  try {
    tx = Transaction.from(row.signed_raw);
  } catch {
    throw new Rejection('invalid_signed_transaction');
  }
  requireThat(
    tx.hash === row.tx_hash &&
      tx.unsignedSerialized === row.unsigned &&
      row.unsigned === auth.unsigned &&
      tx.from === computeAddress(auth.publicKey),
    'persisted_signed_transaction_mismatch',
  );
  try {
    authorize(auth, actors, envelope, now);
  } catch (error) {
    if (error instanceof z.ZodError) throw new Rejection('invalid_authorization');
    throw error;
  }
}
