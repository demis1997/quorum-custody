import React, { useEffect, useState } from 'react';
import type { CustodyControl, ControlStatus } from '../src/compliance.js';
type Inventory = {
  controls: CustodyControl[];
  scope: string;
  policyVersion: number;
  frozen: boolean;
};
export function Compliance({ api }: { api: <T>(path: string) => Promise<T> }) {
  const [data, setData] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ControlStatus | 'ALL'>('ALL');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let active = true;
    void api<Inventory>('/compliance')
      .then((value) => {
        if (active) setData(value);
      })
      .catch(() => {
        if (active) setError('Evidence inventory could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [api]);
  async function download() {
    setExporting(true);
    setError('');
    try {
      const bundle = await api('/compliance/evidence');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'quorum-engineering-evidence.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Evidence export failed. No bundle was generated.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="compliance">
      <div className="card">
        <div className="cardhead">
          <h2>Custody engineering evidence</h2>
          <button className="primary" onClick={() => void download()} disabled={!data || exporting}>
            {exporting ? 'Preparing evidence…' : 'Download evidence inventory'}
          </button>
        </div>
        <p>
          MiCA requirements, implemented controls and remaining gaps. This inventory is not a
          regulatory assessment or certification.
        </p>
        {error && <p role="alert">{error}</p>}
        {!data ? (
          <p>Loading the authenticated control inventory…</p>
        ) : (
          <>
            <p className="note">
              {data.scope} · Current policy {data.policyVersion} ·{' '}
              {data.frozen ? 'Custody frozen' : 'Custody not frozen'}
            </p>
            <p className="note">
              Historical CI verifies its recorded source revision only. Current local edits have no
              hosted execution evidence. Source hashes are unsigned; no independently anchored audit
              trail is claimed.
            </p>
            <label>
              Status{' '}
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as ControlStatus | 'ALL')}
              >
                {[
                  'ALL',
                  'NOT_IMPLEMENTED',
                  'PARTIAL',
                  'IMPLEMENTED',
                  'VERIFIED',
                  'NOT_APPLICABLE',
                ].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <p>
              {
                data.controls.filter((control) => status === 'ALL' || control.status === status)
                  .length
              }{' '}
              of {data.controls.length} requirements shown
            </p>
          </>
        )}
      </div>
      {data?.controls
        .filter((control) => status === 'ALL' || control.status === status)
        .map((control) => (
          <article className="card" key={control.id}>
            <div className="cardhead">
              <h3>{control.id}</h3>
              <span className="tag">{control.status.replaceAll('_', ' ')}</span>
            </div>
            <p>
              <a href={control.source} target="_blank" rel="noreferrer">
                {control.requirement}
              </a>
            </p>
            <p>
              <strong>Control:</strong> {control.control}
            </p>
            <p>
              <strong>Implementation:</strong>{' '}
              {control.implementation.join(' · ') || 'Not implemented'}
            </p>
            <p>
              <strong>Tests:</strong> {control.tests.join(' · ') || 'None'}
            </p>
            <p>
              <strong>Evidence:</strong>{' '}
              {control.evidence.join(' · ') || 'No execution evidence attached'}
            </p>
            <p className="note">
              <strong>Limitation:</strong> {control.limitation}
            </p>
          </article>
        ))}
    </section>
  );
}
