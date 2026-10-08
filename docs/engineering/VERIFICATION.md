# First roadmap slice: execution report

Date: 2026-10-09. Uncommitted working tree based on `425a55d`. No commit, push, merge or deployment was performed for this slice.

## Before and after

Before: signed transactions could reach a new network submission without rechecking current authorization. No signed freeze/denylist fields or regulatory evidence inventory existed.

After: worker broadcast decisions validate complete current authorization and persisted signature/sender under policy/transaction locks, audit the decision and persist the attempt before RPC. Terminal denial blocks the job without releasing reservations or discarding signed bytes. Chain-observed transactions reconcile first. Policy has signed optional freeze/denylist fields enforced by request parsing and signer authorization. The admin UI exposes policy controls and a sourced MiCA engineering inventory with JSON export and source hashes.

## Executed

- `make check`: PASS; typecheck, lint, formatting, build, 26 tests, zero failures/skips.
- `npm audit --json`: PASS; zero reported vulnerabilities.
- `git diff --check`: PASS.
- Evidence inventory generation: PASS; local verification hashes match the allowlisted source files. Generated secrets, shares and raw transaction bytes are not exported.
- Source-only packaging: PASS; public source archive regenerated with existing generated-secret exclusions.

[Local verification record](local-verification.json) binds the local check result to an allowlist of source hashes. It includes the check-log SHA-256. It is unsigned, not independently attested or externally anchored. Changing a covered source file marks `sourceMatches` false in the downloaded bundle; it does not change a regulatory requirement into VERIFIED.

Historical baseline: [PR CI](https://github.com/demis1997/quorum-custody/actions/runs/37847572507) and [push CI](https://github.com/demis1997/quorum-custody/actions/runs/37847569851) passed real native MPC, PostgreSQL, Anvil, browser, integration and recovery checks at `425a55d`. These runs do not verify this slice.

## Pending

Local Docker socket `/_ping` timed out after three seconds; no local PostgreSQL executable was found. No Docker restart was performed because it could interrupt unrelated workloads.

Four new real-stack integration groups are authored but not executed: expiry after real MPC signing blocks submission; observed transaction still reconciles after expiry; policy change after signing blocks old bytes; admin-only evidence API excludes runtime secrets. Existing real integration/recovery suites also require rerunning after these worker/policy changes. Fresh UI screenshot/interaction verification is pending; existing baseline screenshots are retained without representing the new screen.

With running local dependencies: run the project's isolated provision/start workflow, `npm run integration`, `npm run resilience`, and `make screenshots`. Alternatively, obtain explicit approval to commit/push a review branch so the existing hosted workflow runs them. Do not substitute mocked cryptography, database or chain for those checks.

## Limitations and next phase

The authorization boundary is the committed pre-submission decision. Later changes cannot recall an issued RPC or revoke portable signatures. Existing policy-update exclusion still prevents freeze during active MPC. This is not a complete institutional authorization engine.

Next cohesive phase is tenant/client ownership and domain-v2 signed bindings across persistence, APIs and signer manifests, followed by the custody position register/reconciliation and quarterly/on-demand statements. Remaining lifecycle, provider, DORA, audit-integrity and attack-lab phases are detailed in [the implementation plan](IMPLEMENTATION_PLAN.md). No MiCA/DORA compliance, custody authorisation or production-readiness claim is made.
