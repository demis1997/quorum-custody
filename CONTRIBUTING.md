# Contributing

This project is an unaudited portfolio prototype. Work only with synthetic actors
and chain 31337. Follow [AGENTS.md](AGENTS.md). Never add real credentials, shares,
protocol payload logging, private-key export or mainnet URLs.

## Development

Use Node 22.20.0 and the checked-in npm lockfile. The default `.npmrc` uses a project-
local cache. Required native tools: Git, CMake, make, a supported C++17 compiler,
Perl, curl, tar, OpenSSL CLI and `sha256sum` (on macOS, install coreutils if missing).
Upstream recommends Clang 20+; the local proof used AppleClang 21 on ARM64. Anvil
must be on PATH, and Docker/Compose must be running. See the verification record
for the actual Anvil build used. OpenSSL transport CLI and patched native OpenSSL
are separate dependencies.

```sh
make demo
make check
make integration
make stop
```

`make demo` starts a profile once and retains private `.dev/` state. Do not rerun it
on a live profile: stop first, or use an isolated profile. The chain is ephemeral;
retained application state cannot be trusted after restarting Anvil. Use fresh
credentials, signer directories, database volume and chain for the next clean run.

## Isolated integration profile

Run all lifecycle commands in one shell when the host sandbox restricts signaling
processes from another execution context. The suite stops/restarts only PIDs in its
private process manifest and changes the test policy version.

```sh
QUORUM_DEV=.dev-integration QUORUM_PORT_OFFSET=1000 \
  QUORUM_COMPOSE_PROJECT=quorum-custody-integration make demo
QUORUM_DEV=.dev-integration make integration
QUORUM_DEV=.dev-integration make stop
```

The port offset chooses API 5300, signer ports 5401–5403, database 46432 and chain
49545. Generated config remembers the ports/project name; subsequent commands need
only `QUORUM_DEV`. Pick another offset/name if a profile is occupied. Do not delete
a PostgreSQL volume or signer directory to paper over a failing test.

## Commands and review

- `make check`: strict TypeScript, ESLint, Prettier check, compiled UI/API, 15
  unit/property tests with reproducible seeds.
- `make integration`: 17 real boundary groups against cb-mpc, PostgreSQL, mTLS and
  Anvil. Controlled fault injection includes lease expiry, real process restart and
  unrecorded successful broadcast. It does not replace crypto/DB/RPC with mocks.
- `make screenshots`: Playwright capture of the real demo. A native browser may
  fail under a macOS sandbox; the current committed captures used Codex's in-app
  browser instead. Never substitute fixtures or generated images.
- `npm audit`: dependency advisory check; a clean result is not a security audit.
- `docker build -f Dockerfile.native -t quorum-custody-native .`: optional Linux
  native builder; execution status is in verification.md.

Review changes for correctness, meaningful responsibility boundaries, resource
limits, race conditions and unnecessary abstraction. Add tests for failure behavior,
not implementation duplication. Keep domain evidence encoding shared with the
browser; never weaken certificate checks, expiry or distinct-actor verification to
make a demo pass. Inspect generated screenshots for credentials/personal data.

## Public review preparation

Use `scripts/package.py` to produce a source-only archive. It excludes generated
profiles, wrapping keys, certificates, actor keys, node_modules, build artifacts and
Git metadata; it scans the selected files for accidental private-key material and
known generated tokens before packaging. This is an additional check, not a general
secret-detector guarantee. Preserve upstream attribution and license. No commit,
push, publication, deployment or paid operation is part of these local commands.

For opt-in fault controls and real encrypted restore tests, use a fresh profile with
`QUORUM_DEMO_CONTROLS=1 make demo`, then `npm run resilience`. See docs/recovery.md.
Never upload `.dev/`, `.qcb` backups, password files or browser traces as CI artifacts.
