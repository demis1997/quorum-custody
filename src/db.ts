import pg from 'pg';
import { config } from './config.js';
import { Authorization, PolicyEnvelope } from './domain.js';
export const pool = new pg.Pool({
  connectionString: config().databaseUrl,
  max: 8,
  statement_timeout: 5000,
});
export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
export async function audit(
  client: pg.PoolClient,
  actor: string,
  event: string,
  transactionId: string | null,
  details: Record<string, unknown>,
) {
  await client.query('INSERT INTO audit(actor,event,transaction_id,details) VALUES($1,$2,$3,$4)', [
    actor,
    event,
    transactionId,
    details,
  ]);
}
export async function policy(client: pg.PoolClient | pg.Pool = pool): Promise<PolicyEnvelope> {
  return (await client.query('SELECT envelope FROM policy WHERE id=1')).rows[0].envelope;
}
export type TxRow = {
  id: string;
  wallet_id: string;
  requester: string;
  recipient: string;
  value: string;
  chain_id: string;
  nonce: string;
  max_fee: string;
  priority_fee: string;
  gas_limit: string;
  calldata: string;
  unsigned: string;
  digest: string;
  policy_version: number;
  expires_at: Date;
  state: string;
  sign_attempts: number;
  broadcast_attempts: number;
  owner: string | null;
  lease_until: Date | null;
  signed_raw: string | null;
  tx_hash: string | null;
  receipt: unknown;
  error: string | null;
  reserved: string;
};
export async function authorization(
  row: TxRow,
  client: pg.PoolClient | pg.Pool = pool,
): Promise<Authorization> {
  const wallet = (await client.query('SELECT public_key FROM wallets WHERE id=$1', [row.wallet_id]))
    .rows[0];
  const approvals = (
    await client.query(
      'SELECT actor,signature FROM approvals WHERE transaction_id=$1 ORDER BY actor',
      [row.id],
    )
  ).rows;
  return {
    walletId: row.wallet_id,
    transactionId: row.id,
    requester: row.requester,
    digest: row.digest,
    policyVersion: row.policy_version,
    expiresAt: row.expires_at.toISOString(),
    unsigned: row.unsigned,
    publicKey: wallet.public_key,
    approvals,
    policyEnvelope: await policy(client),
  };
}
