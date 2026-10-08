import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatEther, parseEther } from 'ethers';
import { approvalText, canonical } from '../src/encoding.js';
import './style.css';
type Actor = { id: string; role: string; token: string; privateKey: string };
type Wallet = {
  id: string;
  address: string;
  public_key: string;
  reserved: string;
  next_nonce: string;
};
type Tx = {
  id: string;
  wallet_id: string;
  requester: string;
  recipient: string;
  value: string;
  nonce: string;
  digest: string;
  policy_version: number;
  expires_at: string;
  state: string;
  tx_hash: string | null;
  error: string | null;
  max_fee?: string;
  priority_fee?: string;
  unsigned?: string;
};
type Policy = {
  version: number;
  chainId: number;
  recipients: string[];
  perTransaction: string;
  aggregate: string;
  maxFeePerGas: string;
  requiredApprovers: number;
  separationOfDuties: boolean;
};
type Overview = {
  wallets: Wallet[];
  transactions: Tx[];
  signers: { id: string; available: boolean; policyVersion: number | null }[];
  policy: Policy;
};
type Detail = {
  transaction: Tx;
  authorization: {
    walletId: string;
    transactionId: string;
    digest: string;
    policyVersion: number;
    expiresAt: string;
    requester: string;
    approvals: { actor: string }[];
  };
  timeline: {
    sequence: string;
    actor: string;
    event: string;
    details: Record<string, unknown>;
    created_at: string;
  }[];
};
const shorten = (s: string) => s.slice(0, 8) + '…' + s.slice(-6);
const label = (s: string) => s.replaceAll('_', ' ');
const amount = (s: string) => formatEther(s);
async function detachedSignature(text: string, pem: string) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '')), (c) =>
    c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('');
}
function App() {
  const [actor, setActor] = useState<Actor | null>(null),
    [view, setView] = useState('Overview'),
    [data, setData] = useState<Overview | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [policyDraft, setPolicyDraft] = useState<Policy | null>(null),
    [audit, setAudit] = useState<Detail['timeline']>([]);
  async function api<T>(path: string, body?: unknown, key?: string): Promise<T> {
    const res = await fetch('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + actor!.token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await res.json();
    if (!res.ok) throw new Error(label(value.error));
    return value;
  }
  async function refresh() {
    if (!actor) return;
    setData(await api('/overview'));
    if (selected) setDetail(await api('/transactions/' + selected));
    if (view === 'Audit history') setAudit(await api('/audit'));
  }
  useEffect(() => {
    if (!actor) return;
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void refresh().catch((e) => setError(e.message));
    }, 2500);
    return () => clearInterval(timer);
  }, [actor, selected, view]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importActor(file: File) {
    try {
      const value = JSON.parse(await file.text());
      if (!value.id || !value.token || !value.privateKey)
        throw new Error('Invalid development actor file');
      setActor(value);
      setError('');
      setDetail(null);
      setSelected(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const approved = data?.transactions.filter((t) => t.state === 'confirmed').length ?? 0;
  const pending =
    data?.transactions.filter((t) => ['awaiting_approvals', 'ready'].includes(t.state)) ?? [];
  const selectedWallet = data?.wallets[0];
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="brandmark">Q</span> Quorum<span className="custody">CUSTODY</span>
        </div>
        <div className="workspace">DEVELOPMENT WORKSPACE</div>
        <nav>
          {['Overview', 'Transactions', 'Approval queue', 'Policy', 'Audit history'].map(
            (item, i) => (
              <button
                key={item}
                className={view === item ? 'nav active' : 'nav'}
                onClick={() => {
                  setView(item);
                  setDetail(null);
                  setSelected(null);
                }}
              >
                <span className="navicon">{['◈', '↗', '✓', '◇', '≡'][i]}</span>
                {item}
                {item === 'Approval queue' && pending.length > 0 && <b>{pending.length}</b>}
              </button>
            ),
          )}
        </nav>
        <div className="sidebarbottom">
          <span className="dot" />
          Local development network<small>Ethereum · Chain ID 31337</small>
          <div className="prototype">PROTOTYPE · UNAUDITED</div>
          <p>
            Threshold cryptography by Coinbase cb-mpc. Custody application by Quorum. No Coinbase
            endorsement.
          </p>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <span className="breadcrumb">Workspace /</span> {view}
          </div>
          <div className="actor">
            <span className="localpill">Local development network</span>
            <span className="localpill">Prototype</span>
            {actor ? (
              <>
                <span>
                  {actor.id} · {actor.role}
                </span>
                <label className="switch">
                  Switch actor
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => e.target.files?.[0] && void importActor(e.target.files[0])}
                  />
                </label>
              </>
            ) : (
              <span>Development access</span>
            )}
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">POLICY-CONTROLLED MPC</div>
              <h1>{view === 'Overview' ? 'Custody, with a quorum.' : view}</h1>
              <p>
                {view === 'Overview'
                  ? 'A clear view of your local wallet, approvals, and transaction activity.'
                  : 'Local Ethereum transfers · independently verified authorization'}
              </p>
            </div>
            <span className="tag">2 OF 3 SIGNERS</span>
          </div>
          {error && (
            <div role="alert" className="error">
              <strong>Action needs attention</strong>
              <span>{error}</span>
              <button onClick={() => setError('')}>Dismiss</button>
            </div>
          )}
          {!actor ? (
            <section className="card welcome">
              <span className="eyebrow">LOCAL DEVELOPMENT CREDENTIALS</span>
              <h2>Open your development workspace</h2>
              <p>
                Import an actor file generated by <code>make demo</code> from{' '}
                <code>.dev/actors/</code>. Signing keys stay in this browser’s memory and never go
                to the API.
              </p>
              <label className="primary filebutton">
                Import actor file
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => e.target.files?.[0] && void importActor(e.target.files[0])}
                />
              </label>
              <small>
                Use admin.json for wallet and policy setup, requester.json for transfers, and
                alice.json / bob.json for distinct approvals.
              </small>
            </section>
          ) : !data ? (
            <section className="card empty">Loading the real custody backend…</section>
          ) : (
            <>
              {view === 'Overview' && (
                <>
                  <div className="metrics">
                    <div className="metric">
                      <span>Custody wallets</span>
                      <strong>{data.wallets.length.toString().padStart(2, '0')}</strong>
                      <small>secp256k1 · distributed key generation</small>
                    </div>
                    <div className="metric">
                      <span>Signers available</span>
                      <strong>
                        {data.signers.filter((s) => s.available).length}
                        <em>/ 3</em>
                      </strong>
                      <small>Two online participants required to sign</small>
                    </div>
                    <div className="metric">
                      <span>Awaiting authorization</span>
                      <strong>{pending.length.toString().padStart(2, '0')}</strong>
                      <small>{data.policy.requiredApprovers} distinct approvers required</small>
                    </div>
                    <div className="metric">
                      <span>Confirmed transfers</span>
                      <strong>{approved.toString().padStart(2, '0')}</strong>
                      <small>Receipts verified on local Ethereum</small>
                    </div>
                  </div>
                  <div className="twocol">
                    <section className="card">
                      <div className="cardhead">
                        <h2>Wallet overview</h2>
                        <span className="subtle">REAL MPC</span>
                      </div>
                      {selectedWallet ? (
                        <>
                          <div className="walletname">
                            <span className="walleticon">◈</span>
                            <div>
                              <h3>Development treasury</h3>
                              <span>2-of-3 threshold ECDSA</span>
                            </div>
                            <span className="status confirmed">Active</span>
                          </div>
                          <div className="address">{selectedWallet.address}</div>
                          <div className="walletstats">
                            <div>
                              <span>Lifetime reserved</span>
                              <strong>{amount(selectedWallet.reserved)} ETH</strong>
                            </div>
                            <div>
                              <span>Next allocated nonce</span>
                              <strong>{selectedWallet.next_nonce}</strong>
                            </div>
                          </div>
                          <p className="note">
                            Reservations include maximum network fees. Shares remain in separate
                            signer storage.
                          </p>
                        </>
                      ) : (
                        <div className="empty">
                          <p>No wallet yet. Create one through real three-party DKG.</p>
                          {actor.role === 'admin' && (
                            <button
                              disabled={busy}
                              className="primary"
                              onClick={() =>
                                void action(async () => {
                                  await api('/wallets', {});
                                })
                              }
                            >
                              Create MPC wallet
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                    <section className="card">
                      <div className="cardhead">
                        <h2>Signer availability</h2>
                        <span className="subtle">LIVE BACKEND</span>
                      </div>
                      {data.signers.map((signer, i) => (
                        <div className="signer" key={signer.id}>
                          <span className="signericon">0{i + 1}</span>
                          <div>
                            <strong>{signer.id}</strong>
                            <small>
                              Separate process · policy {signer.policyVersion ?? 'unavailable'}
                            </small>
                          </div>
                          <span
                            className={'status ' + (signer.available ? 'confirmed' : 'blocked')}
                          >
                            {signer.available ? 'Available' : 'Offline / busy'}
                          </span>
                        </div>
                      ))}
                      <p className="note">
                        One host simulates three trust domains. This is a development setup.
                      </p>
                    </section>
                  </div>
                </>
              )}
              {(view === 'Transactions' || view === 'Approval queue') && (
                <section className="card">
                  <div className="cardhead">
                    <h2>
                      {view === 'Transactions'
                        ? 'Request a local transfer'
                        : 'Authorization requirements'}
                    </h2>
                    <span className="subtle">CHAIN 31337</span>
                  </div>
                  {view === 'Transactions' ? (
                    <form
                      className="transferform"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        void action(async () => {
                          const value = parseEther(String(form.get('amount'))).toString();
                          const created = await api<Tx>(
                            '/transactions',
                            {
                              walletId: String(form.get('wallet')),
                              recipient: String(form.get('recipient')),
                              value,
                            },
                            crypto.randomUUID(),
                          );
                          setSelected(created.id);
                          setDetail(await api('/transactions/' + created.id));
                        });
                      }}
                    >
                      <label>
                        Wallet
                        <select name="wallet" required>
                          {data.wallets.map((w) => (
                            <option key={w.id} value={w.id}>
                              {shorten(w.address)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Recipient address
                        <input name="recipient" required defaultValue={data.policy.recipients[0]} />
                      </label>
                      <label>
                        Amount · ETH
                        <input
                          name="amount"
                          required
                          placeholder="0.01"
                          pattern="[0-9]+(\.[0-9]{1,18})?"
                        />
                      </label>
                      <button
                        disabled={
                          busy || !selectedWallet || !['requester', 'approver'].includes(actor.role)
                        }
                        className="primary"
                      >
                        Request transfer
                      </button>
                      <p className="note">
                        ETH only · no calldata · 21,000 gas · 2 gwei maximum fee / gas. Limit{' '}
                        {amount(data.policy.perTransaction)} ETH.
                      </p>
                    </form>
                  ) : (
                    <p className="note">
                      Review recipient, amount, nonce, fees, chain, digest, policy version, and
                      expiry before signing. Two distinct approvers; requester self-approval is
                      prohibited.
                    </p>
                  )}
                </section>
              )}
              {['Overview', 'Transactions', 'Approval queue'].includes(view) && (
                <section className="card activity">
                  <div className="cardhead">
                    <h2>
                      {view === 'Approval queue' ? 'Pending approvals' : 'Transaction activity'}
                    </h2>
                    <span className="subtle">
                      {view === 'Approval queue' ? pending.length : data.transactions.length}{' '}
                      REQUESTS
                    </span>
                  </div>
                  <div className="table">
                    <div className="tablerow tableheader">
                      <span>Transfer / recipient</span>
                      <span>Amount</span>
                      <span>Policy</span>
                      <span>Status</span>
                      <span>Nonce</span>
                    </div>
                    {(view === 'Approval queue' ? pending : data.transactions).length === 0 ? (
                      <div className="empty">No transactions in this view.</div>
                    ) : (
                      (view === 'Approval queue' ? pending : data.transactions).map((t) => (
                        <button
                          className={
                            'tablerow transactionrow ' + (selected === t.id ? 'selected' : '')
                          }
                          key={t.id}
                          onClick={() => {
                            setSelected(t.id);
                            void action(async () => setDetail(await api('/transactions/' + t.id)));
                          }}
                        >
                          <span>
                            <strong>{shorten(t.recipient)}</strong>
                            <small>
                              {shorten(t.id)} · {t.requester}
                            </small>
                          </span>
                          <span>
                            <strong>{amount(t.value)} ETH</strong>
                            <small>Local Ethereum</small>
                          </span>
                          <span>v{t.policy_version}</span>
                          <span className={'status ' + t.state}>{label(t.state)}</span>
                          <span>
                            {t.nonce} <b className="arrow">→</b>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </section>
              )}
              {detail && (
                <section className="card detail">
                  <div className="cardhead">
                    <h2>Transaction review & timeline</h2>
                    <span className={'status ' + detail.transaction.state}>
                      {label(detail.transaction.state)}
                    </span>
                  </div>
                  <div className="detailgrid">
                    <div>
                      <span>Recipient</span>
                      <code>{detail.transaction.recipient}</code>
                    </div>
                    <div>
                      <span>Amount</span>
                      <strong>{amount(detail.transaction.value)} ETH</strong>
                    </div>
                    <div>
                      <span>Network / nonce</span>
                      <strong>Local Ethereum · 31337 / {detail.transaction.nonce}</strong>
                    </div>
                    <div>
                      <span>Policy / expiry</span>
                      <strong>
                        v{detail.transaction.policy_version} ·{' '}
                        {new Date(detail.transaction.expires_at).toISOString()}
                      </strong>
                    </div>
                    <div>
                      <span>Maximum fee / priority fee</span>
                      <strong>
                        {Number(detail.transaction.max_fee ?? '2000000000') / 1e9} /{' '}
                        {Number(detail.transaction.priority_fee ?? '1000000000') / 1e9} gwei
                      </strong>
                    </div>
                    <div>
                      <span>Approvers</span>
                      <strong>
                        {detail.authorization.approvals.map((a) => a.actor).join(', ') ||
                          'None yet'}
                      </strong>
                    </div>
                    <div className="full">
                      <span>Exact unsigned transaction digest</span>
                      <code>{detail.transaction.digest}</code>
                    </div>
                    {detail.transaction.tx_hash && (
                      <div className="full">
                        <span>Local-chain transaction hash</span>
                        <code>{detail.transaction.tx_hash}</code>
                      </div>
                    )}
                    {detail.transaction.unsigned && (
                      <details className="full">
                        <summary>Exact unsigned transaction representation</summary>
                        <code>{detail.transaction.unsigned}</code>
                      </details>
                    )}
                  </div>
                  {detail.transaction.error && (
                    <div className="error">{label(detail.transaction.error)}</div>
                  )}
                  {actor.role === 'approver' &&
                    detail.transaction.state === 'awaiting_approvals' && (
                      <button
                        className="primary"
                        disabled={
                          busy || detail.authorization.approvals.some((a) => a.actor === actor.id)
                        }
                        onClick={() =>
                          void action(async () => {
                            const signature = await detachedSignature(
                              approvalText(detail.authorization),
                              actor.privateKey,
                            );
                            await api('/transactions/' + detail.transaction.id + '/approvals', {
                              actor: actor.id,
                              signature,
                            });
                          })
                        }
                      >
                        Sign exact transaction approval as {actor.id}
                      </button>
                    )}
                  <div className="timeline">
                    {detail.timeline.map((event) => (
                      <div className="timelineevent" key={event.sequence}>
                        <span className="timelinepoint" />
                        <div>
                          <strong>{label(event.event)}</strong>
                          <p>
                            {event.actor}
                            {event.details.from
                              ? ' · ' +
                                label(String(event.details.from)) +
                                ' → ' +
                                label(String(event.details.to))
                              : ''}
                            {event.details.reason
                              ? ' · ' + label(String(event.details.reason))
                              : ''}
                          </p>
                        </div>
                        <time>{new Date(event.created_at).toISOString().slice(11, 19)} UTC</time>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {view === 'Policy' && (
                <section className="card">
                  <div className="cardhead">
                    <h2>Signed authorization policy</h2>
                    <span className="tag">VERSION {data.policy.version}</span>
                  </div>
                  <form
                    className="policyform"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        const policy = {
                          ...(policyDraft ?? data.policy),
                          version: data.policy.version + 1,
                        };
                        const signature = await detachedSignature(
                          canonical({ domain: 'quorum-custody/policy/v1', policy }),
                          actor.privateKey,
                        );
                        await api('/policy', { policy, signature });
                        setPolicyDraft(null);
                      });
                    }}
                  >
                    <label>
                      Recipient allowlist
                      <textarea
                        value={(policyDraft ?? data.policy).recipients.join('\n')}
                        onChange={(e) =>
                          setPolicyDraft({
                            ...(policyDraft ?? data.policy),
                            recipients: e.target.value.split('\n'),
                          })
                        }
                      />
                    </label>
                    <div className="twocol">
                      {(['perTransaction', 'aggregate'] as const).map((field) => (
                        <label key={field}>
                          {field === 'perTransaction'
                            ? 'Per-transfer limit · ETH'
                            : 'Lifetime aggregate limit · ETH'}
                          <input
                            value={amount((policyDraft ?? data.policy)[field])}
                            onChange={(e) => {
                              try {
                                setPolicyDraft({
                                  ...(policyDraft ?? data.policy),
                                  [field]: parseEther(e.target.value).toString(),
                                });
                              } catch {
                                setError('Enter a valid ETH amount');
                              }
                            }}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="policyrules">
                      <span>✓ Two distinct approvers</span>
                      <span>✓ Requester self-approval prohibited</span>
                      <span>✓ Local ETH transfers only</span>
                      <span>✓ Reapproval after any policy change</span>
                    </div>
                    <button className="primary" disabled={busy || actor.role !== 'admin'}>
                      Sign & apply next policy version
                    </button>
                    <p className="note">
                      Admin signature is verified by each signer. An offline signer can leave
                      synchronization pending. Resubmit the same signed version through the API
                      after restoring it.
                    </p>
                  </form>
                </section>
              )}
              {view === 'Audit history' && (
                <section className="card">
                  <div className="cardhead">
                    <h2>Application audit</h2>
                    <span className="subtle">APPEND PERMISSION ONLY</span>
                  </div>
                  <p className="note">
                    Application credentials cannot modify these rows. A database administrator can;
                    this table is not immutable.
                  </p>
                  <div className="timeline">
                    {audit.length ? (
                      audit.map((event) => (
                        <div className="timelineevent" key={event.sequence}>
                          <span className="timelinepoint" />
                          <div>
                            <strong>{label(event.event)}</strong>
                            <p>
                              {event.actor} · policy {String(event.details.policyVersion ?? '—')}
                            </p>
                          </div>
                          <time>{new Date(event.created_at).toISOString()}</time>
                        </div>
                      ))
                    ) : (
                      <div className="empty">No audit events yet.</div>
                    )}
                  </div>
                </section>
              )}
            </>
          )}
          <footer>
            Quorum Custody{' '}
            <span>Unaudited portfolio prototype · synthetic data · no real funds</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
