import test from 'node:test';
import assert from 'node:assert/strict';
import { custodyControls, evidenceBundle } from '../src/compliance.js';
test('regulatory inventory has unique IDs, sources, limitations and no unsupported VERIFIED claims', () => {
  assert.equal(new Set(custodyControls.map((c) => c.id)).size, custodyControls.length);
  for (const control of custodyControls) {
    assert.ok(control.source.startsWith('https://'));
    assert.ok(control.limitation.length > 20);
    assert.notEqual(control.status, 'VERIFIED');
    if (control.status === 'NOT_IMPLEMENTED') assert.equal(control.implementation.length, 0);
  }
});
test('evidence inventory hashes only source allowlist and labels historical execution scope', () => {
  const bundle = evidenceBundle();
  assert.equal(bundle.currentExecutionEvidence.length, 1);
  assert.equal(typeof bundle.currentExecutionEvidence[0].sourceMatches, 'boolean');
  assert.ok(bundle.evidence[0].limitation.includes('Historical baseline'));
  for (const file of bundle.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.match(file.path, /^(src|tests|docs)\//);
    assert.doesNotMatch(file.path, /\.dev|\.qcb|\.pem|private|wrapping/);
  }
  assert.equal(bundle.files.length, new Set(bundle.files.map((f) => f.path)).size);
});
