# 005: Offline backups with independently retained checkpoints

A share-only restore can roll back nonce, spending, retry and session history. Back up the complete
signer state as one authenticated password-encrypted envelope, bound to its existing identity and
trust set. Refuse live-process backups, destination overwrites and checkpoint mismatches.

Keep a generation/digest checkpoint outside the signer directory and advance it after persisted
changes. This catches an old backup when the current checkpoint is retained. It deliberately
sacrifices recovery availability when the checkpoint or latest compatible backup is missing.

It is a same-host development safeguard, not Byzantine anti-rollback storage. Do not claim host-loss
recovery, certificate rotation, share refresh or consensus-backed aggregate spending guarantees.
