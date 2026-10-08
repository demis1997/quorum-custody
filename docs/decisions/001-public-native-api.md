# ADR 001: Public C++ API behind a process adapter

Accepted. cb-mpc's pinned public ECDSA-MP API supports secp256k1 threshold access
structures. Use a native executable and implement its documented transport
interface. Node provides HTTPS, evidence verification and session bounds; native
code owns opaque share loading, encryption and cryptographic calls. This avoids
inventing a binding or using unsafe lower-level protocol APIs. The process boundary
makes ownership and share exclusion inspectable; it does not isolate a compromised
host account. DKG uses three processes; signing uses an online pair.
