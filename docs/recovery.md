# Development wallet recovery

Recovery restores one signer's existing encrypted shares **and** policy, spending/nonce ledger,
retry counts, public wallet metadata and persistent session replay history. It never reconstructs
or exports the distributed private key. A retained checkpoint outside the signer directory binds
the latest generation and full state digest. Signers fail startup when their storage differs.

This is a local operator workflow, not a production disaster-recovery system. The backup uses
Node's AES-256-GCM and scrypt (N=32768, r=8, p=1, random salt and IV). It includes the local
wrapping key inside the password-encrypted payload. Store each signer's backup and password
separately; do not collect all three under one production operator. The operator's OS account
already has access to this development state.

## Preconditions

- Keep the original `.dev/config.json`, TLS identities, PostgreSQL state, Anvil state and
  `.dev/recovery/` checkpoints. They are **not** included in a signer backup.
- Stop the target signer before every operator operation. The CLI checks the managed PID and
  pinned TLS health. An exclusive operator lock prevents simultaneous commands and signer startup.
- Use the most recent checkpoint-compatible backup. Any persisted signing attempt, new session,
  wallet or policy change invalidates an older backup. Schedule a new offline backup after changes.
- If an operator command crashes, its exclusive lock is retained. Verify the operator and
  signer are stopped before manually removing only that profile’s matching `.operator.lock`.
- A missing checkpoint is a hard failure. Do not manufacture or roll it back to make a backup fit.
- This does not restore a lost database, chain, TLS identity, password or checkpoint. Directory
  loss is covered; total-host loss requires a separately designed trusted recovery system.

## Operator commands

For an opt-in profile, import admin.json and use **Failure demonstration → Take signer-2 offline**.
Without the panel, `make stop` stops this project's processes and Compose services; start the
project database if using the inventory command. Commands respect `QUORUM_DEV` for isolated profiles.
Create a random password file privately, preferably outside the project on separately protected
storage. The example keeps it in ignored development state for demonstration only:

```sh
mkdir -m 700 .dev/backups
node -e 'const fs=require("node:fs"),c=require("node:crypto");fs.writeFileSync(".dev/backups/password",c.randomBytes(32),{flag:"wx",mode:0o600})'
export QUORUM_RECOVERY_PASSWORD_FILE="$PWD/.dev/backups/password"
npm run recovery -- inspect signer-2
npm run recovery -- backup signer-2 .dev/backups/signer-2.qcb
```

`inspect` reports public wallet IDs/keys, share-file presence, generation and which DKG wallet
IDs are absent from PostgreSQL. It does not return keyshares or wrapping keys. An orphaned DKG
result remains quarantined: it is not automatically registered, deleted or substituted for an
existing wallet. Establish the cause and all three identities before deciding whether to retire
that unused development wallet and create a fresh one. Partially written/inconsistent state
fails checkpoint verification and requires operator investigation.

After a genuine loss of `.dev/signer-2/`, retain the external checkpoint and run:

```sh
npm run recovery -- restore signer-2 .dev/backups/signer-2.qcb
```

Restore refuses an existing destination. Never remove valuable state merely to make it accept a
backup. The real resilience test simulates loss by moving the original directory into a private
quarantine; it preserves that original for diagnosis. Restore authenticates identity, trust set,
generation, digest and ciphertext before creating files. Complete mode-0600 files in a mode-0700
staging directory are fsynced and atomically published. Wrong passwords, tampering, different
identities and stale snapshots fail before publication. Failed I/O staging is retained for
inspection. Restart the signer with **Bring signer-2 online** and make a new approved local transfer.

For a pre-checkpoint development profile only, stop the signer, review its state and run
`npm run recovery -- enroll signer-2`. Enrollment is refused when a checkpoint already exists;
there is no force/reset operation. Do not use enrollment to erase evidence of rollback. New
profiles enroll automatically before their first DKG.

## Certificates, rotation and crash limits

Development certificates last seven days. Their fingerprints also determine cb-mpc party names
and native share wrapping context. Regenerating a certificate or changing the trust set is not
an identity-preserving recovery procedure. For this synthetic prototype, provision a **new**
profile and wallet after expiration. Production identity rotation, share refresh and migration
need their own supported protocol and approval/revocation design; they remain unimplemented.

The checkpoint is an ordinary protected file on the same host, not a hardware monotonic counter
or external consensus service. A host administrator can rewrite it or the backup. A crash between
state writes and checkpoint publication fails closed; this does not prove every power-loss
boundary. Recovery restores ledger state, not globally Byzantine aggregate accounting. Keep the
threat-model limitations in effect.

## Verified exercise

`npm run resilience` uses actual cb-mpc, PostgreSQL, Anvil and managed signer processes. It tests
admin-only fault controls, an offline-signer receipt, orphan inventory, stale-backup rejection,
complete encrypted restore, a new transfer through the restored signer, increasing conservative
reservations and persistent session replay rejection. `make check` includes recovery integrity,
identity, permissions, missing-checkpoint and rollback unit cases. Current execution outcomes are
recorded in verification.md; authored tests are not counted as passed until executed.
