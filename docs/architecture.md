# Architecture

## Boundaries and contracts

The React client constructs an approval payload from API-supplied **reviewable
unsigned bytes and digest**. Its Ed25519 private key is imported from a generated
actor file into browser memory. The API knows public keys and SHA-256 bearer-token
hashes, not approver signing keys. Authentication grants an application role;
cryptographic approval grants authorization for one precise transaction. Local
HTTP is loopback-only; signer transport always uses TLS 1.3 with mutual certificates
and fingerprint pins. No secret travels in a URL or API response.

The TypeScript signer process authenticates coordinator/peer certificates,
validates evidence, establishes a bounded session, and invokes a native process.
The native adapter implements cb-mpc's `data_transport_i` with `SEND`/`RECV` pipe
frames serviced by the signer. Only protocol traffic, public key and DER signature
cross those pipes; opaque shares remain in the native process. This is an executable
adapter, not an invented upstream binding. Private share blobs are AES-GCM encrypted
with random IVs and authenticated protocol/curve/version/party/wallet context.
Opaque blob memory uses upstream's buffer lifecycle; this is not a claim of whole-
process memory erasure. Core dumps are disabled for the native process.

Each signer is a distinct Node process and a distinct storage directory. Each
native session is a fresh child process. Party IDs passed into cb-mpc derive from
unique pinned certificate fingerprints, not caller-provided names. Three local
processes simulate independent participants, but share the same host trust domain.

## Upstream API proof

Pinned source: `0b716706f998633912ee2be9b9bf8909aed66088`.
Read sources: README, LICENSE.md, SECURE_USAGE.md, public `api/ecdsa_mp.h`,
`core/job.h`, `core/access_structure.h`, `tests/unit/api/test_ecdsa_mp_ac.cpp`,
`tests/unit/api/test_ecdsa_mp.cpp`, threshold implementation and demo tree,
CMake/Makefile and OpenSSL build scripts.

- `access_structure_t::Threshold(2, three leaves)` is supported.
- `ecdsa_mp::dkg_ac(job, curve_id::secp256k1, sid, ac, contributors, key_blob)`
  requires all three job participants online. The first two are DKG contributors;
  all three receive distinct access-structure shares.
- `ecdsa_mp::sign_ac(job, ac_key_blob, ac, msg_hash, 0, sig_der)` requires only the
  online quorum. It internally derives additive **shares**, never exports a full
  private scalar to the coordinator, and returns DER only to receiver 0.
- `ecdsa_mp::get_public_key_compressed` exposes the SEC1 public key.
- ECDSA input is the already hashed 32-byte message. Ethereum uses the ethers
  EIP-1559 unsigned serialization's Keccak-256 digest; no double hashing.

All three two-party quorums were exercised. No ordinary signatures are combined.
The full private key is never reconstructed by application code. Upstream's
patched OpenSSL is required and built at a repository-local prefix; system OpenSSL
is used only as a CLI to issue development transport certificates.

## Policy and transaction data

Supported transfer: type 2, chain 31337, native ETH, exactly 21,000 gas, empty
calldata/access list, bounded nonce and fees. Fees are explicit demo defaults:
2 gwei maximum and 1 gwei priority. The allowlist/per-transfer/aggregate limits and
two-or-three approvers are signed by the admin. Aggregate is a **lifetime wallet
budget**, including reserved maximum network fees. It is not a daily rolling limit.

PostgreSQL stores recipient, integer wei value, chain, nonce, both fees, gas,
calldata, exact unsigned bytes, digest, signed policy version and expiry. Approval
signatures bind wallet/request ID, requester, digest, policy version and expiry.
Edits before any signing attempt clear all approvals and recompute bytes/digest;
after signing begins, editing is prohibited. The exact nonce remains reserved.
Policy changes invalidate pending/ready rows. Updating while a persisted signing
operation exists is refused. Propagation failures return `policy_sync_pending`;
retry the identical signed policy to synchronize peers. A quorum must report the
new version before an honest worker will sign under it.

A signed policy authenticates rules but cannot magically provide instantaneous
revocation to disconnected parties. See the threat model for coordinator/database
compromise and aggregate-ledger limitations.

## Persistence and concurrency

Wallet rows serialize lifetime reservations and next-nonce increments. Unique
constraints bind `(wallet_id,nonce)` and `(requester,idempotency_key)`. An actor-
scoped advisory transaction lock makes duplicate requests across different wallets
safe as well. Reusing a key for another payload produces a conflict.

The worker takes short `FOR UPDATE SKIP LOCKED` claims with a random owner UUID,
a 45-second renewable lease, and the next unresolved nonce per wallet. It releases
the database transaction before MPC/RPC. Heartbeats extend only live ownership.
All result writes re-lock and check owner and unexpired lease; stale workers cannot
persist signatures/state. Signer sessions time out within 32 seconds, before the
worker lease expires. Recovered signing work returns to ready (up to 3 attempts),
or blocks on the limit. Native crypto errors are terminal unless explicitly
classified as a recoverable transport/session failure; do not blindly retry
unclassified malicious-protocol errors.

After independent ECDSA verification and recovered-address comparison, the worker
persists signed raw bytes and hash in one transaction. Signing retries and broadcast
retries are separate. Receipt lookup precedes transaction lookup and same-byte
rebroadcast. Five broadcast attempts are allowed; unresolved ambiguity blocks for
manual reconciliation. A chain-reverted receipt is recorded as confirmed with an
error, meaning observed inclusion, not transfer success. The demo/test require
receipt status 1 for the successful-transfer claim.

An ambiguous send may have succeeded. The next attempt looks up the persisted hash,
so it cannot accidentally generate a different payment. External RPC delivery is
not exactly once. Local Anvil receipt checks do not model finality depth or reorgs.
No automatic fee bumping, nonce-gap cancellation or replacement transaction is
implemented; these require new policy/approval semantics.

## Resource bounds and operation

One active session per signer globally, at most three participants, a 30-second
native deadline / 32-second transport deadline, 4 MiB binary frames, 64 MiB encoded
traffic per session, at most 64 queued messages per sender, and bounded sequence
numbers. Receives are unblocked on cancellation. Sender certificates and per-peer
sequence numbers reject unauthorized/mismatched/replayed messages. A manifest hash
includes session, participants, wallet, protocol and full evidence.

Signer replay records are durable. Prototype quotas stop growth at 4,096 prepared
sessions, 100 wallets per signer, and 1,000 requests per wallet; these are deliberately
small development guardrails, not a scalable archival system. An invalid request
cannot create an unbounded queue. An authorized malicious coordinator can still
consume quota and deny service. PostgreSQL audit/history grows with authorized
operations; there is no archival/retention service.

The application database role cannot update/delete audit rows. No hash-chain or
external anchor is claimed. Logs use allowlisted event fields and error codes.
The API does not log request bodies, authorization headers or underlying raw errors.
Signer protocol payloads and native diagnostics are never logged.

Development process manifests record only PIDs and public process labels. Stop
refuses manifests older than 12 hours because of PID reuse risk; manual inspection
is then required. The normal command never uses broad process matching, global
prune, or removes persistent volumes. OS sandbox restrictions may require running
all lifecycle tests within the same permitted shell execution.
