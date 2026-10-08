# Five-minute interview walkthrough

1. Run `make demo` from a clean profile. Explain that Coinbase supplies cb-mpc;
   Quorum contributes the custody application. Show the pinned upstream commit and
   actual `dkg_ac` / `sign_ac` calls in `native/signer.cpp`.
2. Import admin.json in the dashboard. Show real signer availability and the
   compressed public key/address relationship: Ethereum address is the last 20
   bytes of Keccak-256 of the uncompressed SEC1 public key without its prefix.
   ethers independently derives it from the shared public key. No full private key
   is reconstructed and no export endpoint exists.
3. Show the demo's completed 0.01 ETH transfer. Inspect recipient, chain 31337,
   nonce 0, 21,000 gas, max/priority fees, exact unsigned bytes/digest, policy version,
   expiry, alice/bob approvals and receipt-backed transaction hash. The timeline
   records persisted transitions; it is not generated UI fixture data.
4. Explain that the demo stopped signer-3 before bob's approval. Only two native
   participants signed. Independent ECDSA verification and recovered sender
   checks passed before the signed raw transaction was persisted and broadcast.
5. Open the real partially approved request in the queue. Import bob.json, inspect
   the full details, and approve in the browser. The browser signs using WebCrypto;
   the API never receives the private Ed25519 key. If evidence has expired, create
   another request or reapprove it through the documented API before signing begins.
6. Run `make integration` in a separate test profile. Point out rejection of field
   mutation and missing approvals/quorum, API roles, mTLS/session replay, concurrent
   requests/reservations/nonces, fencing and ambiguous broadcast recovery.

Design explanation: use the public upstream API, a native process adapter, short
PostgreSQL transactions, explicit states, approver-held keys and full signer-side
validation. A lost broadcast response means reconcile the same hash, not sign a
new payment. No exactly-once external guarantee is made.

Be candid: this is local and unaudited. One host owns all signer storage, wrapping
keys are local files, audit is mutable by administrators, global spending accounting
trusts PostgreSQL, and offline policy revocation requires more design. These limits
are part of the demonstration, not hidden behind production claims.
