# Institutional implementation plan

Prepared after the 2026-10-09 baseline audit. Work locally in cohesive phases; no commit, push, merge, deployment, paid resources or credential creation without subsequent explicit approval. Preserve PR #1 and its existing evidence.

## First slice: authorization decision and evidence foundation

Priority: close stale broadcast authorization before expanding feature scope.

- Revalidate current signed policy, exact transaction binding, roles, approvals and expiry under policy/transaction locks before each new external broadcast. Fence worker ownership and persist an audited decision/attempt in the same transaction. Preserve receipt/hash reconciliation and conservative nonce/budget reservations on denial.
- Add an optional admin-signed freeze and checksum denylist without rewriting existing signed policy bytes. Enforce in request parsing and signer authorization. UI must explain that active MPC operations and already-issued network submissions cannot be retroactively recalled.
- Build a sourced MiCA engineering catalog with implementation references, tests, evidence and limitations. Expose authenticated dashboard and downloadable evidence inventory. Do not manufacture verification status: whole legal requirements remain PARTIAL/NOT_IMPLEMENTED where constituent controls are missing; no VERIFIED without execution evidence.
- Add meaningful denial tests and real PostgreSQL/Anvil/MPC boundary regression cases. Run local static/unit/build checks; record real integration as pending when blocked.

Exit: reviewable local change, honest test report and explicit remaining gaps. This completes the first cohesive slice, not the eleven-phase roadmap.

## Subsequent phases and dependencies

1. **Tenant authorization (high risk, large):** migration-backed clients/tenants, actor memberships and ownership; API queries and authorization scopes; domain-v2 signed bindings and signer ownership; cross-tenant leakage/ID substitution tests. Depends on data migration and recovery compatibility design.
2. **Policy lifecycle (high risk, large):** signed revocation propagation, final sign decisions, rolling/daily atomic reservations, timelocks, risk approval sets and freeze during active MPC; concurrency/lease tests. Do not release funds merely because a job is blocked.
3. **Custody register/MiCA (high risk, large):** client agreements/policy versions, owned addresses, deposits and double-entry positions, reconciliation and exceptions; valuation inputs with provenance; quarterly and on-demand CSV/PDF statements; instruction-to-movement traceability. Segregation/legal obligations remain externally assessed.
4. **MPC lifecycle (high risk, large):** verify pinned public refresh API and examples; stage/commit all-party ceremony, crash recovery, same-public-key signature tests, epoch/replay handling. Document unsupported replacement and certificate-identity rotation rather than inventing protocols.
5. **Providers (high risk, large):** explicit capabilities for local wrapping, PKCS#11 wrapping/native signing and AWS KMS wrapping/native signing; implementation only against supported mechanisms. Real hardware/cloud tests are gated by available credentials and explicit approval; no mock E2E claims.
6. **DORA operations (medium/high risk, large):** official regulation/RTS mapping, service/supplier inventory, incident workflow, SLOs and measured RTO/RPO under real faults. Map application support separately from firm obligations.
7. **Audit integrity (high risk, medium):** tenant-aware canonical hash chain, serial ordering, independent verifier and signed/external checkpoints; prove tamper detection while documenting administrator rewrite/rollback and key custody boundaries.
8. **Attack lab (medium risk, medium):** ten executable local scenarios with expected/observed outcome and audit linkage; role bypass, tenant substitution, stale/forged approvals, mutation, replay, quorum loss, lease takeover, ambiguous broadcast, stale recovery, audit tampering. Only scenarios with executed outcomes become verified.
9. **UI and quality (medium risk, medium):** populated tenant/client positions, exceptions, policy/risk queues, operations, evidence export; real screenshots. Incremental property/fuzz tests, secret scans and supply-chain provenance.
10. **Publication (low risk, medium):** regenerate case study/diagrams/status and clean source archive after tests, prepare small PRs, request explicit approval for commit/push. No production-readiness or certified-compliance claims.

## Validation and evidence rules

Use `make check` and `npm audit` for each source slice. Run real `npm run integration`, `npm run resilience` and browser captures when services are available. Evidence records must name the command, outcome, source revision, execution time and environment; historical results cannot verify changed source. A control catalog is an inventory, not an audit attestation. Track NOT_IMPLEMENTED, PARTIAL, IMPLEMENTED, VERIFIED and NOT_APPLICABLE distinctly, with scoped reasons and tests/evidence references.
