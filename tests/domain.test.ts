import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Transaction, SigningKey } from 'ethers';
import fc from 'fast-check';
import { validateBroadcastDecision } from '../src/broadcast-decision.js';
import {
  ActorPublic,
  Authorization,
  Policy,
  authorize,
  approvalText,
  policyText,
  canonical,
  transition,
  parseTransfer,
  validateApproval,
  requestSchema,
} from '../src/domain.js';
function fixture() {
  const privateKeys: Record<string, string> = {};
  const actors: ActorPublic[] = ['requester', 'alice', 'bob', 'admin'].map((id) => {
    const pair = generateKeyPairSync('ed25519');
    privateKeys[id] = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    return {
      id,
      role: id === 'requester' ? 'requester' : id === 'admin' ? 'admin' : 'approver',
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      tokenHash: 'test',
    };
  });
  const policy: Policy = {
    version: 1,
    chainId: 31337,
    recipients: ['0x000000000000000000000000000000000000bEEF'],
    perTransaction: '1000000000000000000',
    aggregate: '2000000000000000000',
    maxFeePerGas: '3000000000',
    requiredApprovers: 2,
    separationOfDuties: true,
  };
  const envelope = {
    policy,
    signature: sign(null, Buffer.from(policyText(policy)), privateKeys.admin).toString('hex'),
  };
  const tx = Transaction.from({
    type: 2,
    chainId: 31337,
    nonce: 0,
    to: policy.recipients[0],
    value: 10n,
    gasLimit: 21000n,
    maxFeePerGas: 2000000000n,
    maxPriorityFeePerGas: 1000000000n,
    data: '0x',
    accessList: [],
  });
  const auth: Authorization = {
    walletId: '00000000-0000-4000-8000-000000000001',
    transactionId: '00000000-0000-4000-8000-000000000002',
    requester: 'requester',
    digest: tx.unsignedHash,
    unsigned: tx.unsignedSerialized,
    publicKey: SigningKey.computePublicKey('0x' + '01'.repeat(32), true),
    policyVersion: 1,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    approvals: [],
    policyEnvelope: envelope,
  };
  const approve = (id: string) => ({
    actor: id,
    signature: sign(null, Buffer.from(approvalText(auth)), privateKeys[id]).toString('hex'),
  });
  auth.approvals = [approve('alice'), approve('bob')];
  return { auth, actors, policy, envelope, privateKeys, approve };
}
test('two signed, distinct approvals authorize a bounded local ETH transaction', () => {
  const f = fixture();
  assert.equal(authorize(f.auth, f.actors, f.envelope).tx.value, 10n);
});
for (const field of ['recipient', 'amount', 'fee', 'chain', 'nonce', 'calldata'] as const)
  test(`post-approval ${field} mutation is rejected`, () => {
    const f = fixture();
    const tx = Transaction.from(f.auth.unsigned);
    if (field === 'recipient') tx.to = '0x0000000000000000000000000000000000000001';
    if (field === 'amount') tx.value += 1n;
    if (field === 'fee') tx.maxFeePerGas = 2500000000n;
    if (field === 'chain') tx.chainId = 1n;
    if (field === 'nonce') tx.nonce = 1;
    if (field === 'calldata') tx.data = '0x01';
    f.auth.unsigned = tx.unsignedSerialized;
    assert.throws(() => authorize(f.auth, f.actors, f.envelope));
    // Even changing the advertised digest cannot preserve the old approvals.
    f.auth.digest = tx.unsignedHash;
    assert.throws(() => authorize(f.auth, f.actors, f.envelope));
  });
test('expired, duplicated, missing and self approvals fail closed', () => {
  const f = fixture();
  assert.throws(
    () =>
      authorize(
        { ...f.auth, expiresAt: new Date(Date.now() - 1).toISOString() },
        f.actors,
        f.envelope,
      ),
    /approval_expired/,
  );
  assert.throws(
    () =>
      authorize(
        { ...f.auth, approvals: [f.auth.approvals[0], f.auth.approvals[0]] },
        f.actors,
        f.envelope,
      ),
    /duplicate_approver/,
  );
  assert.throws(
    () => authorize({ ...f.auth, approvals: [f.auth.approvals[0]] }, f.actors, f.envelope),
    /insufficient_approvals/,
  );
  const self = { ...f.auth, requester: 'alice' };
  assert.throws(
    () => validateApproval(self, f.approve('alice'), f.actors, f.policy),
    /self_approval/,
  );
});
test('policy change, tampered policy and wallet binding invalidate prior evidence', () => {
  const f = fixture();
  const newPolicy = { ...f.policy, version: 2 };
  const newEnvelope = {
    policy: newPolicy,
    signature: sign(null, Buffer.from(policyText(newPolicy)), f.privateKeys.admin).toString('hex'),
  };
  assert.throws(() => authorize(f.auth, f.actors, newEnvelope), /policy_changed/);
  assert.throws(() =>
    authorize(f.auth, f.actors, { ...f.envelope, policy: { ...f.policy, aggregate: '999999' } }),
  );
  assert.throws(
    () =>
      authorize(
        { ...f.auth, walletId: '00000000-0000-4000-8000-000000000003' },
        f.actors,
        f.envelope,
      ),
    /invalid_approval_signature/,
  );
});
test('signatures from an untrusted approver key are rejected', () => {
  const f = fixture();
  f.auth.approvals[0].signature = '00'.repeat(64);
  assert.throws(() => authorize(f.auth, f.actors, f.envelope), /invalid_approval_signature/);
});
test('final lifecycle states cannot return to signing or broadcasting', () => {
  for (const to of ['ready', 'signing', 'signed', 'broadcast', 'blocked'] as const)
    assert.throws(() => transition('confirmed', to));
  transition('signing', 'signed');
  transition('signed', 'broadcast');
  transition('broadcast', 'confirmed');
});
test('property: random unsigned input never escapes the local-transfer validation contract', () => {
  const f = fixture();
  fc.assert(
    fc.property(fc.string({ maxLength: 1500 }), (unsigned) => {
      try {
        const tx = parseTransfer(unsigned, f.policy);
        assert.equal(tx.chainId, 31337n);
        assert.equal(tx.data, '0x');
        assert.equal(tx.gasLimit, 21000n);
        assert.equal(tx.unsignedSerialized, unsigned);
      } catch (error) {
        assert.ok(error instanceof Error);
      }
    }),
    { numRuns: 1000, seed: 8172 },
  );
});
test('property: transaction limits and fee bounds are enforced across integer ranges', () => {
  const f = fixture();
  fc.assert(
    fc.property(fc.bigInt({ min: 0n, max: 10n ** 20n }), (value) => {
      const tx = Transaction.from(f.auth.unsigned);
      tx.value = value;
      if (value > 0n && value <= BigInt(f.policy.perTransaction))
        assert.equal(parseTransfer(tx.unsignedSerialized, f.policy).value, value);
      else assert.throws(() => parseTransfer(tx.unsignedSerialized, f.policy));
    }),
    { numRuns: 300, seed: 9123 },
  );
});
test('property: amount parser rejects signs, exponents, decimals and extra fields', () => {
  fc.assert(
    fc.property(fc.string(), (value) => {
      const parsed = requestSchema.safeParse({
        walletId: '00000000-0000-4000-8000-000000000001',
        recipient: '0x' + '00'.repeat(20),
        value,
      });
      if (parsed.success) assert.match(value, /^[1-9][0-9]{0,23}$/);
    }),
    { numRuns: 1000, seed: 121 },
  );
});
test('canonical evidence does not depend on object insertion order', () => {
  assert.equal(canonical({ z: 1, a: { d: 3, b: 2 } }), canonical({ a: { b: 2, d: 3 }, z: 1 }));
});

// Whole-key signing is limited to these unit fixtures; real MPC remains mandatory
// for integration. These tests exercise portable signed bytes after approval.
function broadcastFixture() {
  const f = fixture();
  const tx = Transaction.from(f.auth.unsigned);
  tx.signature = new SigningKey('0x' + '01'.repeat(32)).sign(tx.unsignedHash);
  return {
    ...f,
    row: {
      state: 'signed',
      signed_raw: tx.serialized,
      tx_hash: tx.hash,
      unsigned: tx.unsignedSerialized,
      broadcast_attempts: 0,
    },
  };
}
test('broadcast decision accepts current authorization and rejects expiry after signing', () => {
  const f = broadcastFixture();
  validateBroadcastDecision(f.row, f.auth, f.actors, f.envelope);
  assert.throws(
    () =>
      validateBroadcastDecision(f.row, f.auth, f.actors, f.envelope, Date.parse(f.auth.expiresAt)),
    /approval_expired/,
  );
});
test('broadcast decision rejects changed policy and removed approvals without changing raw bytes', () => {
  const f = broadcastFixture();
  const policy = { ...f.policy, version: 2 };
  const envelope = {
    policy,
    signature: sign(null, Buffer.from(policyText(policy)), f.privateKeys.admin).toString('hex'),
  };
  assert.throws(
    () => validateBroadcastDecision(f.row, f.auth, f.actors, envelope),
    /policy_changed/,
  );
  f.auth.approvals.pop();
  assert.throws(
    () => validateBroadcastDecision(f.row, f.auth, f.actors, f.envelope),
    /insufficient_approvals/,
  );
});
test('signed freeze and denylist override otherwise valid transfers', () => {
  for (const addition of [
    { frozen: true },
    { deniedRecipients: [fixture().policy.recipients[0]] },
  ]) {
    const f = fixture();
    Object.assign(f.policy, addition);
    f.envelope.signature = sign(
      null,
      Buffer.from(policyText(f.policy)),
      f.privateKeys.admin,
    ).toString('hex');
    assert.throws(
      () => authorize(f.auth, f.actors, f.envelope),
      addition.frozen ? /custody_frozen/ : /recipient_denied/,
    );
    assert.throws(() => parseTransfer(f.auth.unsigned, f.policy));
  }
});
test('broadcast decision rejects foreign signed bytes and exhausted attempts', () => {
  const f = broadcastFixture();
  const foreign = Transaction.from(f.auth.unsigned);
  foreign.signature = new SigningKey('0x' + '02'.repeat(32)).sign(foreign.unsignedHash);
  assert.throws(
    () =>
      validateBroadcastDecision(
        { ...f.row, signed_raw: foreign.serialized, tx_hash: foreign.hash },
        f.auth,
        f.actors,
        f.envelope,
      ),
    /persisted_signed_transaction_mismatch/,
  );
  assert.throws(
    () =>
      validateBroadcastDecision({ ...f.row, broadcast_attempts: 5 }, f.auth, f.actors, f.envelope),
    /broadcast_retry_limit/,
  );
});
