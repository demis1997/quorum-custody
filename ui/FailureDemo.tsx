import React, { useEffect, useState } from 'react';
type Status = {
  signers: { id: string; online: boolean; available: boolean; policyVersion: number | null }[];
  jobs: {
    id: string;
    state: string;
    owner: string | null;
    lease_until: string | null;
    sign_attempts: number;
    broadcast_attempts: number;
    error: string | null;
    tx_hash: string | null;
  }[];
  recovery: { id: string; status: string; generation?: number; wallets?: number }[];
};
type Api = <T>(path: string, body?: unknown) => Promise<T>;
export function FailureDemo({ api }: { api: Api }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const value = await api<Status>('/demo');
        if (!cancelled) setStatus(value);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);
  async function change(signer: string, action: string) {
    setBusy(true);
    setError('');
    try {
      await api('/demo/signers', { signer, action });
      setStatus(await api('/demo'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="card">
        <div className="cardhead">
          <h2>Failure demonstration</h2>
          <span className="tag">DEVELOPMENT ONLY</span>
        </div>
        <p className="note">
          These controls affect real local signer processes. Taking two signers offline prevents
          signing. They do not change approvals, policies, transaction bytes or persisted outcomes.
        </p>
        <ol className="demosteps">
          <li>Take signer-3 offline and leave signer-1 and signer-2 available.</li>
          <li>
            Request a local transfer as requester. Import alice and bob separately to sign the exact
            approval.
          </li>
          <li>Return as admin. Observe a real receipt below, then bring signer-3 online.</li>
        </ol>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {!status ? (
          <p className="empty">Reading the real development processes…</p>
        ) : (
          status.signers.map((s) => (
            <div className="signer" key={s.id}>
              <div>
                <strong>{s.id}</strong>
                <small>
                  {s.online
                    ? s.available
                      ? 'Online · available'
                      : 'Online · protocol busy'
                    : 'Offline'}{' '}
                  · policy {s.policyVersion ?? 'unavailable'}
                </small>
              </div>
              <button
                className="primary"
                disabled={busy || !s.online}
                onClick={() => void change(s.id, 'offline')}
                aria-label={'Take ' + s.id + ' offline'}
              >
                Take offline
              </button>
              <button
                disabled={busy || s.online}
                onClick={() => void change(s.id, 'online')}
                aria-label={'Bring ' + s.id + ' online'}
              >
                Bring online
              </button>
            </div>
          ))
        )}
      </section>
      <section className="card activity">
        <div className="cardhead">
          <h2>Worker ownership & recovery</h2>
          <span className="subtle">LIVE DATABASE</span>
        </div>
        <p className="note">
          A worker lease fences stale owners. Signing retries and broadcast retries are separate.
          Recovery reconciles an existing transaction hash before rebroadcasting the same bytes.
        </p>
        <div className="table">
          <div className="tablerow tableheader">
            <span>Transaction / outcome</span>
            <span>Lease owner</span>
            <span>Lease expiry</span>
            <span>Sign attempts</span>
            <span>Broadcast attempts</span>
          </div>
          {status?.jobs.length === 0 && <p className="empty">No transaction work yet.</p>}
          {status?.jobs.map((job) => (
            <div className="tablerow" key={job.id}>
              <span>
                <strong>{job.id.slice(0, 8)}</strong>
                <small>
                  {job.state}
                  {job.error ? ' · ' + job.error.replaceAll('_', ' ') : ''}
                </small>
                {job.tx_hash && <small title={job.tx_hash}>{job.tx_hash.slice(0, 12)}…</small>}
              </span>
              <span title={job.owner ?? ''}>{job.owner?.slice(0, 8) ?? 'Unclaimed'}</span>
              <span>
                {job.lease_until
                  ? new Date(job.lease_until).toISOString().slice(11, 19) + ' UTC'
                  : '—'}
              </span>
              <span>{job.sign_attempts}</span>
              <span>{job.broadcast_attempts}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card">
        <div className="cardhead">
          <h2>Wallet recovery readiness</h2>
          <span className="subtle">LOCAL OPERATOR</span>
        </div>
        <p className="note">
          Stop a signer before inspecting or backing up its complete share, ledger, policy and
          replay history. Restore requires the original identity, retained external checkpoint,
          database and chain. No backup bytes or wrapping keys are returned by this dashboard.
        </p>
        {status?.recovery.map((s) => (
          <div className="signer" key={s.id}>
            <strong>{s.id}</strong>
            <span>
              {s.status.replaceAll('_', ' ')}
              {s.generation ? ` · generation ${s.generation} · ${s.wallets} wallets` : ''}
            </span>
          </div>
        ))}
        <p className="note">
          Use the operator commands in docs/recovery.md. A newer checkpoint invalidates an older
          backup. Same-host checkpoints are not protection from a host administrator.
        </p>
      </section>
    </>
  );
}
