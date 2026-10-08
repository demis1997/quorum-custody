# ADR 002: PostgreSQL without Redis

Accepted. Row locks, uniqueness, transactional advisory locks and fenced leases
provide the required honest-coordinator reservation/idempotency/ownership semantics.
There is no concrete Redis requirement. Persist exact bytes/digest and signed
raw/hash before RPC. Never hold transactions during MPC or chain calls. Reserve
maximum fee exposure conservatively; lower unresolved nonces block later work.
PostgreSQL is authoritative global application state, not a Byzantine spending
ledger or immutable audit system. Exactly-once external delivery is not claimed.
