# Threat model and security limitations

## Assets and assumptions

Assets: opaque signer shares; local wrapping keys; approver/admin Ed25519 keys;
TLS identities; authorized transaction bytes; global spending/nonce state; audit
history. This is synthetic development state and must never be used for real funds.
The cb-mpc implementation and its patched dependency build are trusted upstream
components. The application uses public validation APIs; it is not cryptographically
audited and has no side-channel or certification claim.

All processes run on one host under one OS user. Directory separation, mutual TLS,
separate share files and encryption demonstrate application boundaries; they do not
provide host-administrator isolation. Containers on one host would have the same
fundamental limitation. There are no independent production trust domains.

## Compromise scenarios

- **Coordinator:** can deny service, delay/reorder approved requests, consume
  sessions, and broadcast an already authorized transaction. It cannot fabricate
  signatures by two distinct approval keys, change approved transaction fields,
  change a signer's local wallet public key, or alter a signed policy without the
  corresponding key. It can undermine **global aggregate accounting** if it can
  bypass PostgreSQL or rotate quorum views: local signer ledgers do not establish
  a shared Byzantine spending history. It can also use still-valid old evidence
  at signers whose policy revocation has not propagated. Signer-local limits,
  signatures, nonce conflict checks and expiry constrain but do not eliminate
  these attacks. The coordinator's service TLS identity is not an approval key.
- **One approver:** can provide one approval, read the synthetic portfolio, or
  request a transfer. It cannot self-approve its own request or satisfy the required
  distinct quorum alone. Compromise of two authorized approval keys can authorize
  allowed transfers; global budget guarantees still depend on trusted application
  state. Browser XSS could access an imported key, so restrictive CSP and no
  external scripts are used, but there is no hardened approval device.
- **Admin:** can sign a broader allowlist/limits and update policy, but cannot
  replace the signer-pinned actor trust set through the API. Admin compromise
  materially weakens authorization policy. Trust-key rotation/revocation is a
  manual provisioning operation and is not implemented as a production workflow.
- **One signer:** can leak its share and local transport identity, lie about
  availability, abort protocols, or consume quota. One share cannot produce a valid
  2-of-3 signature. Two compromised signers can sign outside application policy and
  thereby defeat custody. Native memory, wrapping key and TLS key compromise are
  all signer compromises.
- **Database/application DB credential:** can tamper with application state and
  spending/nonce allocation, cause denied service, delete approvals, and append
  false audit events. Application credentials cannot update/delete existing audit
  rows. A database administrator can alter/delete all rows; audit is not immutable.
  Detached approval and admin signatures are independently checked by signers;
  state tampering alone does not forge new transaction approval signatures.
- **Network attacker:** lacks a pinned development certificate and is rejected
  by mutual TLS. Existing-session peers cannot change sender identity, participants,
  context or sequence. No attempt is made to defend against host administrators,
  traffic analysis, comprehensive DoS or a compromised CA plus pinned-key operator.
- **Local chain/RPC:** can lie about inclusion, balances or chain identity, or reset
  state. The prototype trusts the local Anvil instance; chainId checks are not
  authentication of an arbitrary RPC provider. There is no mainnet/RPC failover.

## Storage and recovery

Shares are AES-GCM encrypted and authenticated to curve/protocol/version/party/wallet
context, in mode-0600 files under mode-0700 directories. Wrapping keys are next to
those files, not in a KMS/HSM. An OS account can decrypt its own signer state; the
same development OS account owns all three. TLS CA private material and all local
actor files are also on this host. Secret provisioning is not an enterprise identity
system. Seven-day certificates require manual renewal/new profiles.

DKG may leave orphaned share files if the coordinator crashes before registering
its wallet. Partial file-write failure can leave an unusable share. No backup,
refresh, share restoration, wallet import/export or secure erase is implemented.
After restoring signer state from stale backups, nonce/reservation/session records
could roll back; no monotonic hardware counter exists. Never discard ledgers while
keeping a valuable key. Crashes and disk failures at every fsync boundary have not
been exhaustively tested. Atomic JSON uses file and directory fsync; session marker
creation is fail-closed for normal restarts but is not a complete power-loss proof.

Reservation gaps block higher nonces rather than pretending completion. Signing
failures retain conservative budgets. A request can be reapproved only before any
signing attempt. A failed attempt that consumed local signer budget is deliberately
not automatically refunded. A new chain profile is necessary after Anvil reset.

## Test scope

Tests exercise actual cryptographic quorum behavior, real database locks and unique
constraints, real HTTP/mTLS, and real Anvil transfers. The crash/fencing test
explicitly expires a persisted lease to avoid a 45-second wait and abandons a claimed
worker in the harness; it also kills/restarts the real API process. Ambiguous
broadcast recovery actually sends the persisted transaction then restarts the API
without recording the outcome. These are controlled fault injections, not an
exhaustive crash-consistency proof or a packet-loss chaos environment.

Parsing/property tests use synthetic random inputs and fixed reproducible seeds.
They do not fuzz cb-mpc internals. No complete upstream test suite, sanitizer,
constant-time analysis, CPU side-channel check, long-running soak, multi-host test,
reorg/finality simulation or external security review is claimed.

## Remaining work, in impact order

1. Establish independent signer/approver trust domains, external wrapping-key
   protection, key/certificate rotation and tested backups/recovery. Never use the
   current development credentials or storage design for valuable funds.
2. Replace global budget/nonce trust in PostgreSQL with an explicit authenticated,
   consensus-backed reservation design if coordinator/database compromise must
   preserve aggregate spending guarantees. Design offline policy revocation and
   monotonic anti-rollback state together; quorum-local counters are insufficient.
3. Expand real crash/partition tests to every persistence boundary, multi-host
   deployment, disk loss, stale restore, session cancellation and queue exhaustion;
   run sanitizer/upstream test lanes and independent application security review.
4. Add operational nonce-gap recovery, approved replacement/fee-bump flows,
   certificate renewal, wallet orphan reconciliation, archival and retention.
5. Verify and maintain an all-services container deployment and hosted CI results;
   extend chain finality/reorg handling before even considering a public network.

None of these are marked complete. The implemented local flow is an unaudited
portfolio demonstration, not production custody.
