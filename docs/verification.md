# Verification record

Original baseline: 8 October 2026 (Asia/Nicosia). Historical statements below describe
the pre-publication run; see the 9 October update for subsequent work. All successful application transfers used
synthetic balances on local Anvil chain 31337. No commit, push, publication,
external deployment or payment was performed.

## Verified environment and pins

- Node 22.20.0; npm 10.9.3; CMake 3.30.5; AppleClang 21.0.0; macOS ARM64.
- Anvil 1.3.5-nightly, commit `9cd8a9511bc7206cb251721fa42420a76c668ae3`,
  build timestamp 2025-09-16. CI separately specifies official release v1.3.1;
  that CI runner/version has not been executed remotely.
- Docker engine 28.0.1; PostgreSQL 16.10 Alpine image pinned to digest
  `sha256:029660641a0cfc575b14f336ba448fb8a75fd595d42e1fa316b9fb4378742297`.
- cb-mpc `0b716706f998633912ee2be9b9bf8909aed66088`; patched OpenSSL 3.6.4,
  source tarball SHA-256 `9bffaa1ad1e07b354c21bd3324ec02fa15579f45a7d0494b3e74bc449b7333ef`.
- npm dependency graph is locked in package-lock.json. Latest `npm audit --json`
  returned zero known vulnerabilities across runtime and development dependencies.
  This is an advisory check, not a security audit.

## Executed commands and results

Initial upstream proof:

```sh
git clone https://github.com/coinbase/cb-mpc.git work/cb-mpc
git -C work/cb-mpc rev-parse HEAD
CBMPC_OPENSSL_ROOT="$PWD/work/openssl" \
  sh work/cb-mpc/scripts/openssl/build-static-openssl-macos-m1.sh
cmake -S outputs/quorum-custody/native -B work/native-build \
  -DCMAKE_BUILD_TYPE=Release -DCBMPC_SOURCE="$PWD/work/cb-mpc" \
  -DCBMPC_OPENSSL_ROOT="$PWD/work/openssl"
cmake --build work/native-build -j 6
python3 work/native-smoke.py
```

Passed real three-process DKG and each of `[1,2]`, `[1,3]`, `[2,3]` signing.
The standalone proof's public DER signature was independently verified with noble
secp256k1. This preliminary adapter used static development party labels; the
finished adapter derives globally unique native party names from pinned certificate
fingerprints. The later fresh-source demo verified the finished identity mapping.
No share/private scalar was emitted by the adapter.

From the application directory:

```sh
npm install --ignore-scripts --cache ../../work/npm-cache
npm run provision
docker compose --env-file .dev/compose.env up -d --wait
node --import tsx scripts/migrate.ts
npm run build
node --import tsx scripts/start.ts
npm run demo
```

Passed real wallet creation, missing-approval rejection, real two-signer signing
with signer-3 terminated, independent verification, broadcast and successful local
receipt, signer rejection of altered approved bytes, and insufficient-quorum
rejection. Public example wallet:
`0x66Ddf7E5923bE9fDB4872967D1Ee6a32C63CC2E8`; successful transaction hash:
`0xc05dc9b8d3e28678fbe6b2a646808761fc31835bb7197f47678bfb369daddbd7`.

The dependency audit initially flagged ws and later a development lint dependency.
Updated ethers/Express/pg/zod/Vite/typescript-eslint to exact versions in the lockfile;
subsequent full audit reported 0 vulnerabilities. The updated Vite build completed
in under a second. No failing integration was substituted with mock crypto.

Isolated real integration:

```sh
QUORUM_DEV=.dev-test QUORUM_PORT_OFFSET=1000 \
  QUORUM_COMPOSE_PROJECT=quorum-custody-test npm run provision
QUORUM_DEV=.dev-test node --import tsx scripts/start.ts
QUORUM_DEV=.dev-test npm run integration
```

Passed **17 real test groups**, using actual cb-mpc, PostgreSQL, mTLS and Anvil:

1. API authentication, roles, and no arbitrary-digest signing route.
2. Rejection of an HTTPS client without a mutual TLS certificate.
3. Real DKG, separately persisted shares, independent address derivation.
4. Concurrent duplicate requests and conflicting idempotency payloads.
5. Insufficient/duplicate/self approvals.
6. Signer rejection of recipient/value/fee/chain mutation after approval.
7. Real signing with one signer offline; direct native one-party signing fails.
8. Independent signature checks, broadcast and successful receipt.
9. Both alternate supported two-party quorums.
10. Session mismatch, unauthorized participant, context mismatch, sequence replay,
    persistent session replay, a ~32-second incomplete-session timeout, retry limit.
11. Concurrent aggregate reservations and unique contiguous nonce allocation.
12. Expired approvals and clearing evidence after edits.
13. Concurrent worker claims, lease recovery and stale-owner fencing, API restart.
14. A real unrecorded successful send followed by API restart/hash reconciliation.
15. Policy invalidation at API/signers and rejection of rollback.
16. Database denial of audit update/delete by the application role.
17. API secret/keyshare exclusion and logging checks.

That run exposed TLS socket listener accumulation. It was fixed by checking already
established pinned sockets directly and using a once-only callback on new sockets;
limits were not raised. The later fresh run emitted no listener warnings.

Fresh source copy (no node_modules, generated state or build artifacts copied):

```sh
rsync -a --exclude '.dev*' --exclude .build/ --exclude node_modules/ \
  --exclude dist/ outputs/quorum-custody/ work/fresh-quorum/
cd work/fresh-quorum
QUORUM_PORT_OFFSET=2000 QUORUM_COMPOSE_PROJECT=quorum-custody-fresh make demo
npm run integration
```

`make demo` passed from the source copy: clean lockfile install, fresh pinned upstream
clone, patched OpenSSL build, native compilation, UI build, new credentials, separate
PostgreSQL volume, new three-party DKG and successful offline-signer local transfer.
Example fresh wallet `0x3006b546e8B6EE63B98848866cB620e6ACb6Ca9d`, transaction hash
`0x00d29fc0d69e54d0d7708c59541eb73d29cb1c67245920c7915040b2632896ce`.

The fresh integration rerun passed the first **16** groups, including the final
certificate-derived native identities. Its strengthened runtime logging test then
failed because the test request omitted its idempotency key and reached the wrong
validation branch (`idempotency_key_required`). The test was corrected to include
an idempotency key. This was a harness error, not a mocked replacement or an
application integration success claim.

Latest source:

```sh
make check
npm run typecheck
npm run lint
npm audit --json
```

Passed strict types, lint, Prettier, compiled UI/API and **15 unit/property tests**
with 0 failures/skips. Property suites ran 1,000 random parsing cases, 300 integer
amount cases and 1,000 input-validation cases with explicit reproducible seeds.
All application test groups use real systems; unit/property cases use ephemeral
synthetic signing keys.

The final corrected integration rerun uses `.dev-review`, port offset 3000 and
project `quorum-custody-review`. At the current recording point it is **pending**:
Docker stopped responding to its local socket during the interrupted execution.
Even `GET /_ping` timed out. Restarting Docker would affect unrelated containers
and therefore awaits the user's approval. This pending rerun includes the runtime
log check and final native-error classification, lock-order, strict authorization
schema, five-second RPC bounds, configuration caching and settled preparation/cancellation
changes. `make check` passed after all of these changes; they are not
being represented as already integration-verified.

## Screenshots and browser checks

Native `node --import tsx scripts/screenshots.ts` first found no installed browser;
a project-local browser download was attempted. Launch then failed under the macOS
sandbox (`MachPortRendezvousServer` permission denied). The real dashboard was
successfully opened in Codex's in-app browser instead.

Captured actual backend state and inspected all three JPEGs for rendering and
absence of tokens, private keys, keyshares and personal data:

- `docs/images/wallet-overview.jpg`: real distributed wallet and three live signers.
- `docs/images/approval-queue.jpg`: real alice-approved transfer, exact digest,
  recipient/amount/chain/nonce/fees/expiry, and audit events.
- `docs/images/completed-transaction.jpg`: real receipt-confirmed transfer and
  persisted state transitions with its deterministic transaction hash.

A subsequent in-app browser check imported bob.json, used WebCrypto Ed25519 to
approve the real pending transfer, and observed `ready` with `alice, bob` evidence.
No API private-key response, UI fixtures, image generation or fabricated state was
used. Screenshots record the initial successful demo, before the final header labels
were expanded to explicitly show “Local development network” and “Prototype”.

## Unexecuted or bounded paths

- Hosted CI was authored with real native/DB/chain steps; it was not pushed or run
  remotely. Optional Dockerfile.native was authored, not built/tested.
- No full upstream test suite, sanitizer/constant-time tests, independent audit,
  multi-host deployment, mainnet, reorg/finality simulation, full crash/disk-loss
  matrix or production recovery exercise was run.
- The crash/worker test injects lease expiry in real PostgreSQL and abandons a
  claimed harness worker; the real API process is restarted. It is not an exhaustive
  kill-at-every-MPC-instruction test.
- The unrecorded-broadcast recovery test uses a genuinely sent transaction and
  real receipt. It injects loss of persistence of the response, not physical network
  packet loss or exactly-once delivery.
- OS sandbox signaling restrictions required process lifecycle commands to share
  the permitted execution context. The interrupted latest run is not counted as
  a successful final integration rerun.

No required test is silently marked passed. See threat-model.md for remaining work.

## 9 October: CI, failure demonstration and recovery

Preserved the user's README update `d221f38`. The first hosted run compiled the
real native adapter, completed the Anvil demo and passed checks; browser automation
then failed on an exact navigation name containing an icon. Added stable accessible
nav labels and wait for the browser-approved transaction receipt before integration.
Split CI stages, retained project-only teardown and uploaded allowlisted reports and
real PNG screenshots without generated profiles, backups or browser traces.

Local `make check` under pinned Node 22.20.0 passed types, lint, formatting, build
and 20 unit/property cases (15 existing plus 5 recovery boundary cases). The shell
defaulted to Node 18 once; that unsupported-runtime build failure was corrected by
selecting the documented Node 22 runtime. Added an explicit package engine range.

Hosted run [37845966122](https://github.com/demis1997/quorum-custody/actions/runs/37845966122)
on commit `9ce3432` passed the complete real native/demo, 20 checks, browser approval
and failure controls, all 17 integration groups, all 6 resilience groups, artifact
upload and project-only teardown. The restored signer completed a new real transfer
with signer-3 offline, and replayed session IDs stayed rejected. The original signer
directory was moved into private quarantine to inject loss; the database, chain, TLS
identity and independent checkpoint survived. This is not a total-host-loss test. The host Docker socket remains
unresponsive, so this round uses the hosted Linux runner for end-to-end verification.

Four real hosted PNG screenshots were downloaded from the verification artifact,
visually inspected and embedded in the README: wallet-overview.png, approval-queue.png,
completed-transaction.png and failure-demonstration.png. They show explicit local
network/prototype labels and no credentials, wrapping keys or keyshares. Historical
JPEGs remain as baseline evidence. A final backup snapshot consistency guard,
pre-action/failure audit records and worker-row layout refinement are covered by the
subsequent final CI run; its status will be recorded after completion.
