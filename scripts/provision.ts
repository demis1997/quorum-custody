import { generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateDir, atomicJson, dev } from '../src/config.js';
import { Policy, policyText, tokenHash } from '../src/domain.js';
privateDir(dev);
privateDir(resolve(dev, 'tls'));
privateDir(resolve(dev, 'actors'));
if (existsSync(resolve(dev, 'config.json'))) {
  console.log('Existing development identity retained.');
  process.exit(0);
}
const tls = resolve(dev, 'tls');
function openssl(args: string[]) {
  execFileSync('openssl', args, { stdio: 'ignore' });
}
openssl([
  'req',
  '-x509',
  '-newkey',
  'rsa:3072',
  '-nodes',
  '-keyout',
  resolve(tls, 'ca.key'),
  '-out',
  resolve(tls, 'ca.crt'),
  '-subj',
  '/CN=Quorum development CA',
  '-days',
  '7',
]);
const fingerprints: Record<string, string> = {};
for (const id of ['coordinator', 'signer-1', 'signer-2', 'signer-3']) {
  const key = resolve(tls, id + '.key'),
    csr = resolve(tls, id + '.csr'),
    crt = resolve(tls, id + '.crt'),
    ext = resolve(tls, id + '.ext');
  openssl([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    csr,
    '-subj',
    `/CN=${id}`,
  ]);
  writeFileSync(
    ext,
    `subjectAltName=DNS:localhost,DNS:${id},IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE\n`,
    { mode: 0o600 },
  );
  openssl([
    'x509',
    '-req',
    '-in',
    csr,
    '-CA',
    resolve(tls, 'ca.crt'),
    '-CAkey',
    resolve(tls, 'ca.key'),
    '-CAcreateserial',
    '-out',
    crt,
    '-days',
    '7',
    '-extfile',
    ext,
  ]);
  chmodSync(key, 0o600);
  fingerprints[id] = new X509Certificate(readFileSync(crt)).fingerprint256;
  if (id.startsWith('signer')) {
    privateDir(resolve(dev, id));
    writeFileSync(resolve(dev, id, 'wrapping.key'), randomBytes(32), { mode: 0o600 });
  }
}
chmodSync(resolve(tls, 'ca.key'), 0o600);
const offset = Number(process.env.QUORUM_PORT_OFFSET ?? 0);
const ports = { api: 4300 + offset, chain: 48545 + offset, database: 45432 + offset };
const project = process.env.QUORUM_COMPOSE_PROJECT ?? 'quorum-custody';
const actors = [];
let adminPrivate = '';
for (const [id, role] of [
  ['requester', 'requester'],
  ['alice', 'approver'],
  ['bob', 'approver'],
  ['carol', 'approver'],
  ['admin', 'admin'],
] as const) {
  const keypair = generateKeyPairSync('ed25519');
  const token = randomBytes(32).toString('base64url');
  const publicKey = keypair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privateKey = keypair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  if (role === 'admin') adminPrivate = privateKey;
  atomicJson(resolve(dev, 'actors', id + '.json'), { id, role, token, privateKey, publicKey });
  actors.push({ id, role, publicKey, tokenHash: tokenHash(token) });
}
const policy: Policy = {
  version: 1,
  chainId: 31337,
  recipients: ['0x000000000000000000000000000000000000bEEF'],
  perTransaction: '1000000000000000000',
  aggregate: '10000000000000000000',
  maxFeePerGas: '3000000000',
  requiredApprovers: 2,
  separationOfDuties: true,
};
const policyEnvelope = {
  policy,
  signature: sign(null, Buffer.from(policyText(policy)), adminPrivate).toString('hex'),
};
const dbPassword = randomBytes(24).toString('hex'),
  adminPassword = randomBytes(24).toString('hex');
atomicJson(resolve(dev, 'config.json'), {
  demoControls: process.env.QUORUM_DEMO_CONTROLS === '1',
  actors,
  ports,
  project,
  signers: [1, 2, 3].map((n) => ({
    id: `signer-${n}`,
    url: `https://localhost:${4400 + offset + n}`,
    fingerprint: fingerprints[`signer-${n}`],
  })),
  coordinatorFingerprint: fingerprints.coordinator,
  databaseUrl: `postgresql://quorum_app:${dbPassword}@127.0.0.1:${ports.database}/quorum`,
  rpcUrl: `http://127.0.0.1:${ports.chain}`,
  policyEnvelope,
});
atomicJson(resolve(dev, 'database-admin.json'), {
  url: `postgresql://quorum_admin:${adminPassword}@127.0.0.1:${ports.database}/quorum`,
  appPassword: dbPassword,
});
writeFileSync(
  resolve(dev, 'compose.env'),
  `POSTGRES_PASSWORD=${adminPassword}\nQUORUM_DB_PORT=${ports.database}\n`,
  { mode: 0o600 },
);
console.log(
  'Generated local TLS identities and development actor files under .dev/ (never commit).',
);
