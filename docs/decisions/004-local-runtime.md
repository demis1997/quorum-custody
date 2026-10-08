# ADR 004: Verified hybrid local runtime

Accepted for this prototype. Build cb-mpc natively on its supported macOS/Linux
platforms, run three independent signer processes, and use Docker Compose for
PostgreSQL. Run local Anvil on PATH. This reduces the first integration to native
public APIs rather than hiding failures behind an unverified container stack.
The project includes a Linux native-builder Dockerfile and CI lane, but their
execution status is separately documented. Full-container trust-domain deployment
is remaining work. All network listeners default to loopback and chain 31337.
