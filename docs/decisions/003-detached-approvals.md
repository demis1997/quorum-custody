# ADR 003: Approver-held detached signing keys

Accepted. API bearer tokens establish roles but cannot serve as transaction
approval evidence: a compromised coordinator sees bearer tokens. Independent
Ed25519 approval keys sign a canonical application-domain payload covering exact
transaction digest, wallet/request IDs, requester, policy version and expiry.
Admin signs policy separately. Signers pin the public actor trust set and verify
all evidence. Browser clients import development actor files into memory; no key
is returned by an application endpoint. This is development key management and
needs a hardened independent approval device for any stronger deployment.
