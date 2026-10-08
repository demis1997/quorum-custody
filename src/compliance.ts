import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type ControlStatus =
  | 'NOT_IMPLEMENTED'
  | 'PARTIAL'
  | 'IMPLEMENTED'
  | 'VERIFIED'
  | 'NOT_APPLICABLE';
export type CustodyControl = {
  id: string;
  requirement: string;
  source: string;
  control: string;
  status: ControlStatus;
  implementation: string[];
  tests: string[];
  evidence: string[];
  limitation: string;
};
const mica = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02023R1114-20240109';
const policySource = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32025R0305';
export const custodyControls: readonly CustodyControl[] = [
  {
    id: 'MICA-70-1',
    requirement: 'Article 70(1): safeguard client ownership and prevent own-account use',
    source: mica,
    control: 'Exact transaction authorization and controlled share access',
    status: 'PARTIAL',
    implementation: ['src/domain.ts', 'src/signer.ts', 'src/worker.ts'],
    tests: ['tests/domain.test.ts', 'tests/integration.ts'],
    evidence: ['baseline-ci'],
    limitation:
      'No tenant/client ownership or client position register; no proof of insolvency protection.',
  },
  {
    id: 'MICA-70-2',
    requirement: 'Article 70(2): safeguard client funds other than e-money tokens',
    source: mica,
    control: 'Asset perimeter',
    status: 'NOT_APPLICABLE',
    implementation: ['src/domain.ts'],
    tests: ['tests/domain.test.ts'],
    evidence: ['baseline-ci'],
    limitation:
      'Limited to this local ETH-only demo with no fiat client funds. Reassess if its asset perimeter changes; no legal exemption is asserted.',
  },
  {
    id: 'MICA-75-1',
    requirement: 'Article 75(1): client agreement and custody terms',
    source: mica,
    control: 'Versioned client agreement linked to owned accounts',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'No client contracts, fees, governing law or client authentication agreement workflow.',
  },
  {
    id: 'MICA-75-2',
    requirement: 'Article 75(2): named client positions and instruction-linked movements',
    source: mica,
    control: 'Client position register and reconciliation',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'Wallet balances, reservations and transaction history do not constitute a client position register.',
  },
  {
    id: 'MICA-75-3',
    requirement: 'Article 75(3): custody policy, risk controls and electronic summary on request',
    source: mica,
    control: 'Signed policy and custody engineering documentation',
    status: 'PARTIAL',
    implementation: ['src/domain.ts', 'src/custody.ts', 'docs/threat-model.md'],
    tests: ['tests/domain.test.ts', 'tests/integration.ts'],
    evidence: ['baseline-ci'],
    limitation:
      'No approved client-facing custody policy, governance review or complete fraud/negligence controls. New freeze/broadcast edits have no hosted execution evidence yet.',
  },
  {
    id: 'MICA-75-4',
    requirement: 'Article 75(4): client rights and events affecting positions',
    source: mica,
    control: 'Rights/event ingestion and client position updates',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation: 'No rights-event or fork distribution processing.',
  },
  {
    id: 'MICA-75-5',
    requirement: 'Article 75(5): statements at least every three months and on client request',
    source: mica,
    control: 'Balance, valuation and period transfers in electronic statements',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'No client register, valuation provenance, statement scheduler or CSV/PDF statement generator.',
  },
  {
    id: 'MICA-75-6',
    requirement: 'Article 75(6): procedures for prompt return of assets or access',
    source: mica,
    control: 'Quorum failure and same-identity signer recovery',
    status: 'PARTIAL',
    implementation: ['src/recovery.ts', 'scripts/recovery.ts', 'docs/recovery.md'],
    tests: ['tests/recovery.test.ts', 'tests/resilience.ts'],
    evidence: ['baseline-ci'],
    limitation:
      'Same-host recovery does not demonstrate a client asset-return process or whole-platform disaster recovery.',
  },
  {
    id: 'MICA-75-7',
    requirement: 'Article 75(7): on-chain, legal and operational segregation',
    source: mica,
    control: 'Client versus proprietary asset ownership and segregated custody',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'No proprietary/client ownership classifications or insolvency/legal assessment. Separate demo wallets alone are insufficient.',
  },
  {
    id: 'MICA-75-8',
    requirement: 'Article 75(8): attributable-loss liability',
    source: mica,
    control: 'Incident attribution, loss valuation and contract responsibilities',
    status: 'NOT_IMPLEMENTED',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'No incident attribution or liability workflow; software cannot settle legal responsibility.',
  },
  {
    id: 'MICA-75-9',
    requirement: 'Article 75(9): authorised sub-custody and client information',
    source: mica,
    control: 'Sub-custodian due diligence and disclosure',
    status: 'NOT_APPLICABLE',
    implementation: [],
    tests: [],
    evidence: [],
    limitation:
      'No third-party custodians in the local demo. Reassess before introducing external custody services.',
  },
  {
    id: 'RTS-305-12',
    requirement: '2025/305 Article 12: custody-policy application information',
    source: policySource,
    control: 'Technical control inventory and evidence references',
    status: 'PARTIAL',
    implementation: ['src/compliance.ts', 'docs/engineering/GAP_ANALYSIS.md'],
    tests: ['tests/compliance.test.ts'],
    evidence: [],
    limitation:
      'An engineering inventory is not a CASP authorisation application or regulatory assessment.',
  },
  {
    id: 'RTS-1140',
    requirement: '2025/1140: records of services, activities, orders and transactions',
    source: 'https://eur-lex.europa.eu/eli/reg_del/2025/1140/oj/eng',
    control: 'Structured application event retention',
    status: 'PARTIAL',
    implementation: ['src/db.ts', 'src/schema.sql'],
    tests: ['tests/integration.ts'],
    evidence: ['baseline-ci'],
    limitation:
      'No full RTS field mapping/retention controls, independent audit verifier, hash chain or external checkpoints.',
  },
];
const evidenceFiles = [
  'src/domain.ts',
  'src/broadcast-decision.ts',
  'src/worker.ts',
  'src/compliance.ts',
  'src/api.ts',
  'src/signer.ts',
  'src/custody.ts',
  'src/recovery.ts',
  'src/db.ts',
  'src/schema.sql',
  'tests/domain.test.ts',
  'tests/compliance.test.ts',
  'tests/integration.ts',
  'tests/recovery.test.ts',
  'tests/resilience.ts',
  'docs/engineering/GAP_ANALYSIS.md',
  'docs/engineering/IMPLEMENTATION_PLAN.md',
  'docs/engineering/AUTHORIZATION_BOUNDARY.md',
];
// Fixed allowlist only: never recursively read generated state, secrets or backups.
export function evidenceBundle() {
  const files = evidenceFiles.map((path) => ({
    path,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }));
  const local = JSON.parse(readFileSync('docs/engineering/local-verification.json', 'utf8')) as {
    outcome: string;
    command: string;
    executedAt: string;
    environment: string;
    passed: number;
    skipped: number;
    sourceHashes: Record<string, string>;
    limitation: string;
  };
  const currentHashes = new Map(files.map((file) => [file.path, file.sha256]));
  const sourceMatches =
    Object.keys(local.sourceHashes).length === files.length &&
    Object.entries(local.sourceHashes).every(([path, hash]) => currentHashes.get(path) === hash);
  return {
    format: 'quorum-custody/engineering-evidence/v1',
    generatedAt: new Date().toISOString(),
    scope: 'Local ETH prototype; engineering inventory, not compliance certification',
    controls: custodyControls,
    files,
    evidence: [
      {
        id: 'baseline-ci',
        sourceRevision: '425a55d961faf959a461f0441e64bbe6df7ebb0e',
        url: 'https://github.com/demis1997/quorum-custody/actions/runs/37847572507',
        outcome: 'PASS',
        commands: ['make check', 'npm run integration', 'npm run resilience', 'make screenshots'],
        limitation:
          'Historical baseline only. Does not verify current local edits or a whole regulatory requirement.',
      },
    ],
    currentExecutionEvidence: [{ ...local, sourceMatches }],
    integrity:
      'Hashes identify exported source contents. The manifest is not signed or externally anchored; a privileged actor can regenerate it.',
  };
}
