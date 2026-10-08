# Engineering gap analysis

Audit date: 2026-10-09. Baseline: `425a55d961faf959a461f0441e64bbe6df7ebb0e`, PR [#1](https://github.com/demis1997/quorum-custody/pull/1). This is a local ETH prototype, not an authorised custodian. The eleven-phase institutional roadmap is not complete.

## Baseline evidence

`make check` passed locally: typecheck, lint, build and 20 tests, zero skipped. `npm audit` reported zero vulnerabilities. Both hosted checks on the baseline passed: [push](https://github.com/demis1997/quorum-custody/actions/runs/37847569851) and [PR](https://github.com/demis1997/quorum-custody/actions/runs/37847572507). Those runs execute 17 real integration groups and six recovery/failure groups against cb-mpc, PostgreSQL and Anvil. They do not verify subsequent local edits. Four existing PNG captures came from actual hosted browser execution.

Reviewed native adapter/public API and pinned upstream secure-usage guidance; configuration, transport, signer, orchestration, domain, custody, database, worker, HTTP, recovery, demo controls, UI; schema/migration, provisioning/start/stop, packaging/build/CI, tests and engineering documents. Dependencies remain pinned. Existing source contains no HSM/KMS provider integration, tenant/client register, compliance dashboard or statement subsystem.

## Critical findings and trust boundaries

1. **High: stale authorization at broadcast.** `processClaim` verifies approvals before MPC, but signed/broadcast jobs can submit raw bytes after approvals expire or policy changes. The first implementation slice must revalidate immediately before each new external submission, serialize its decision with policy updates, audit it and fail closed. Already-observed chain transactions must still reconcile. A policy change cannot recall an RPC already issued or revoke portable ECDSA bytes.
2. **High: global identities and resources.** Actor IDs, policy, wallet visibility, approval bindings, signer ledgers and audit have no tenant/client ownership. This cannot be fixed by adding a tenant header. Introduce ownership and tenant-scoped authorization atomically across persistence, endpoints, signed bindings, signer manifests and migrations before calling the system multi-tenant.
3. **High: custody accounting absent.** Wallet addresses and lifetime reservations are not a client position register, balance ledger or reconciliation. There is no deposit ingestion, client instruction ownership, corporate-action handling or quarterly/on-demand valuation statement.
4. **High: host/root compromise.** Share wrapping keys, shares and recovery checkpoints share a host trust boundary. Backup detects tampering/staleness relative to the retained anchor; total-host rollback is not independently prevented. Audit is append-only for the ordinary application role, not hash-chained or externally anchored.
5. **Medium: policy lifecycle incomplete.** Two/three distinct approval signatures, expiry, exact transaction binding, allowlist, fee and lifetime budget limits exist. Signed emergency freeze/denylist, daily/rolling limits, timelocks, approval revocation propagation, risk escalation and simulation are missing at baseline. Existing signing operations prevent ordinary policy changes; this is not an immediate emergency stop of an active MPC round.
6. **Medium: MPC lifecycle incomplete.** Real DKG and all three quorum pairs are exercised. Pinned public upstream `refresh_ac` exists but is not integrated or verified here. No participant replacement, independent refresh ceremony or safe certificate rotation is implemented. Never substitute an invented protocol or reconstruct/export a key.
7. **Medium: provider capability separation absent.** Current implementation is software threshold ECDSA with local AES-GCM share wrapping. It does not imply PKCS#11, AWS KMS threshold signing or production hardware protection.
8. **Medium: operations evidence incomplete.** Local failure/recovery tests are real. DORA mapping, incident management, independently tested RTO/RPO, monitoring/SLOs, supplier inventory and ten-scenario attack lab remain missing. No complete host/database/chain disaster recovery is demonstrated.

## Regulatory scope and evidence limits

Official sources were checked on the audit date. Map engineering requirements to controls and retain limitations; no software test proves authorisation, insolvency segregation, client contracts, liability allocation or regulatory compliance. MiCA Article 70 safeguarding and Article 75 custody requirements are the starting scope. Article 75(5) includes client-requested statements as well as a three-month minimum interval. Separate client wallet addresses alone do not prove legal segregation.

- [MiCA consolidated text](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1114-20240109): Articles 68, 70, 75.
- [ESMA Article 75](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-75-providing-custody-and).
- [Delegated Regulation 2025/305](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32025R0305): Article 12 custody-policy information for authorisation applications. This is different from the existing-entity notification regime in Regulation 2025/303.
- [Delegated Regulation 2025/1140](https://eur-lex.europa.eu/eli/reg_del/2025/1140/oj/eng): recordkeeping technical standards; retention, record formats and field-level requirements need a separate implementation review.
- [ESMA Q&A 2578](https://www.esma.europa.eu/publications-data/questions-answers/2578): client/proprietary wallet separation.
- [ESMA Q&A 2608](https://www.esma.europa.eu/publications-data/questions-answers/2608): sub-custody scope.
- [EBA Article 75 reference](https://www.eba.europa.eu/regulation-and-policy/single-rulebook/interactive-single-rulebook/17894) and [PSD2/MiCA opinion](https://www.eba.europa.eu/sites/default/files/2025-06/e2958c99-a1b0-4b07-9d31-bcba0a28dbe7/Opinion%20on%20the%20interplay%20between%20PSD2%20and%20MiCA.pdf): EMT/payment perimeter requires further analysis if supported assets change. The prototype currently supports synthetic local ETH, no fiat/EMTs.

## Execution constraint

Docker's local daemon is unresponsive and PostgreSQL is not available locally. Restarting Docker may interrupt unrelated workloads; no restart is authorised. Baseline hosted evidence remains valid for its SHA. New real integration tests must remain explicitly pending until the dependencies run or the user approves pushing the prepared changes for hosted CI.
