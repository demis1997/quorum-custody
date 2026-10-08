import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dev, config } from '../src/config.js';
const secrets = JSON.parse(readFileSync(resolve(dev, 'database-admin.json'), 'utf8'));
const pool = new pg.Pool({ connectionString: secrets.url });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(readFileSync('src/schema.sql', 'utf8'));
  // Password is generated hex and never printed. DDL cannot use value placeholders here.
  if (!/^[a-f0-9]{48}$/.test(secrets.appPassword)) throw new Error('password_format');
  const exists = await client.query("SELECT 1 FROM pg_roles WHERE rolname='quorum_app'");
  if (!exists.rowCount)
    await client.query(`CREATE ROLE quorum_app LOGIN PASSWORD '${secrets.appPassword}'`);
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query('GRANT USAGE ON SCHEMA public TO quorum_app');
  await client.query('GRANT SELECT,INSERT,UPDATE ON policy,wallets,transactions TO quorum_app');
  await client.query('GRANT SELECT,INSERT,DELETE ON approvals TO quorum_app');
  await client.query('GRANT SELECT,INSERT ON audit TO quorum_app');
  await client.query('GRANT USAGE ON SEQUENCE audit_sequence_seq TO quorum_app');
  await client.query('INSERT INTO policy(id,envelope) VALUES(1,$1) ON CONFLICT(id) DO NOTHING', [
    config().policyEnvelope,
  ]);
  await client.query('COMMIT');
  console.log('Database migrated; app role cannot update/delete audit.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
