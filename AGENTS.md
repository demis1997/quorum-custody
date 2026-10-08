# Engineering standards

This is an unaudited local-only portfolio prototype. Use synthetic data and
locally generated credentials; never use real funds or mainnet. Do not commit,
push, publish, or deploy without an explicit subsequent user instruction.

Use Clean Code, SOLID, high cohesion, low coupling, encapsulation and composition
with practical judgment. DRY, KISS and YAGNI matter more than pattern counts.
Use meaningful names, explicit contracts and focused responsibilities. Follow
idiomatic C++ and TypeScript. Separate policy/state from HTTP, PostgreSQL,
Ethereum and native MPC adapters. Prefer clear code over clever abstractions.
Avoid inheritance except the required upstream transport adapter, unnecessary
factories/interfaces/microservices and generic utilities. Review repeated work,
resource bounds, race conditions and stale worker ownership. Add meaningful
behavior and failure-boundary tests; review completed changes for correctness,
readability and avoidable complexity.

Use only cb-mpc's verified public API. No private-key reconstruction, keyshare
exports, mock cryptography disguised as integration, or arbitrary-digest HTTP
signing. Preserve upstream licensing. Never log secrets, bearer tokens, protocol
payloads or shares. Keep generated state under ignored `.dev/` and `.build/`.

Verified commands and outcomes are in docs/verification.md. `make demo` passed
from an isolated fresh source copy; `make check` and `make test` pass.
`npm run integration` passed 17 real groups on the initial test profile; the final
corrected rerun status is explicitly recorded. `make screenshots` is sandbox-blocked
on this host; real in-app browser captures are provided. `make stop`, optional
Linux builder and hosted CI have separate execution status in that record.
Do not label a command verified until its recorded outcome actually confirms it.

Recovery must retain full policy/ledger/replay history, reject stale or missing checkpoints,
and require an offline signer. Keep fault controls opt-in, loopback and admin-only.
`npm run resilience` is the real recovery path; record its execution outcome before claiming success.
