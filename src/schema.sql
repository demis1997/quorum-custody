CREATE TABLE IF NOT EXISTS policy (id int PRIMARY KEY CHECK(id=1), envelope jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS wallets (
 id uuid PRIMARY KEY, public_key text NOT NULL UNIQUE, address text NOT NULL UNIQUE,
 next_nonce bigint NOT NULL CHECK(next_nonce>=0), reserved numeric(78,0) NOT NULL DEFAULT 0 CHECK(reserved>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transactions (
 id uuid PRIMARY KEY, wallet_id uuid NOT NULL REFERENCES wallets(id), requester text NOT NULL,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 recipient text NOT NULL, value numeric(78,0) NOT NULL CHECK(value>0), chain_id bigint NOT NULL CHECK(chain_id=31337),
 nonce bigint NOT NULL, max_fee numeric(78,0) NOT NULL, priority_fee numeric(78,0) NOT NULL,
 gas_limit bigint NOT NULL CHECK(gas_limit=21000), calldata text NOT NULL CHECK(calldata='0x'), unsigned text NOT NULL,
 digest text NOT NULL, policy_version int NOT NULL, expires_at timestamptz NOT NULL,
 reserved numeric(78,0) NOT NULL, state text NOT NULL CHECK(state IN ('awaiting_approvals','ready','signing','signed','broadcast','confirmed','blocked')),
 sign_attempts int NOT NULL DEFAULT 0, broadcast_attempts int NOT NULL DEFAULT 0,
 owner uuid, lease_until timestamptz, signed_raw text, tx_hash text UNIQUE,
 receipt jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(requester,idempotency_key), UNIQUE(wallet_id,nonce),
 CHECK((signed_raw IS NULL)=(tx_hash IS NULL)), CHECK(state NOT IN ('signed','broadcast','confirmed') OR signed_raw IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS work_queue ON transactions(state,nonce);
CREATE TABLE IF NOT EXISTS approvals (
 transaction_id uuid NOT NULL REFERENCES transactions(id), actor text NOT NULL,
 signature text NOT NULL, digest text NOT NULL, policy_version int NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(transaction_id,actor)
);
CREATE TABLE IF NOT EXISTS audit (
 sequence bigserial PRIMARY KEY, transaction_id uuid REFERENCES transactions(id), actor text NOT NULL,
 event text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
