import { useState, useEffect } from 'react';

// Parse a comma/space-separated ticker string into an ordered, de-duplicated
// list (mirrors the Options page's parser).
function parseTickers(str) {
  const seen = new Set();
  const out = [];
  for (const raw of (str ?? '').split(/[,\s]+/)) {
    const t = raw.trim().toUpperCase();
    if (t && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
}

function fmt(n) { return (n || 0).toLocaleString('en-US'); }
function fmtPct(p) {
  if (p == null) return 'new';
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(0)}%`;
}

function BellIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// One row of the today-vs-yesterday preview returned by /check-now.
function PreviewRow({ row }) {
  const { ticker, today, prev, hasBaseline, call, put, callPct, putPct } = row;
  return (
    <tr>
      <td className="alerts-tk">
        {ticker}
        {today?.price != null && <div className="alerts-tk-price">${Number(today.price).toFixed(2)}</div>}
      </td>
      <td className={call ? 'alerts-surge-cell' : ''}>
        <span className="alerts-dim">{fmt(prev?.callVol)}</span>
        <span className="alerts-arrow"> → </span>
        <span className="alerts-now">{fmt(today?.callVol)}</span>
        <span className={`alerts-pct${call ? ' up' : ''}`}> ({fmtPct(callPct)})</span>
        {call && <span className="alerts-badge call">SURGE</span>}
      </td>
      <td className={put ? 'alerts-surge-cell' : ''}>
        <span className="alerts-dim">{fmt(prev?.putVol)}</span>
        <span className="alerts-arrow"> → </span>
        <span className="alerts-now">{fmt(today?.putVol)}</span>
        <span className={`alerts-pct${put ? ' dn' : ''}`}> ({fmtPct(putPct)})</span>
        {put && <span className="alerts-badge put">SURGE</span>}
      </td>
      <td className="alerts-baseline">
        {hasBaseline ? (prev?.date ?? '—') : <span className="alerts-dim">no prior day yet</span>}
      </td>
    </tr>
  );
}

export default function Alerts() {
  const [email, setEmail]         = useState('');
  const [tickerInput, setTickers] = useState('');
  const [threshold, setThreshold] = useState(50);   // percent, UI-friendly
  const [minVolume, setMinVolume] = useState(1000);
  const [subscription, setSubscription] = useState(null);
  const [status, setStatus]       = useState(null);  // { emailConfigured }
  const [busy, setBusy]           = useState(false);
  const [msg, setMsg]             = useState(null);   // { kind: 'ok'|'err', text }
  const [preview, setPreview]     = useState(null);   // result of /check-now

  // Learn whether SMTP is wired up so we can warn the user upfront.
  useEffect(() => {
    fetch('/api/alerts/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ emailConfigured: false }));
  }, []);

  async function lookup() {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setBusy(true); setMsg(null); setPreview(null);
    try {
      const res = await fetch(`/api/alerts/subscription?email=${encodeURIComponent(e)}`);
      if (res.status === 404) { setMsg({ kind: 'err', text: 'No subscription found for that email yet.' }); setSubscription(null); return; }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySubscription(json.subscription);
      setMsg({ kind: 'ok', text: 'Loaded your existing subscription.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  }

  function applySubscription(sub) {
    setSubscription(sub);
    setTickers((sub.tickers ?? []).join(', '));
    if (sub.threshold != null) setThreshold(Math.round(sub.threshold * 100));
    if (sub.minVolume != null) setMinVolume(sub.minVolume);
  }

  function changeEmail(value) {
    setEmail(value);
    if (subscription && value.trim().toLowerCase() !== subscription.email) {
      setSubscription(null);
      setPreview(null);
    }
  }

  async function subscribe(e) {
    e?.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    const tickers = parseTickers(tickerInput);
    if (!cleanEmail) { setMsg({ kind: 'err', text: 'Enter your email.' }); return; }
    if (!tickers.length) { setMsg({ kind: 'err', text: 'Enter at least one ticker.' }); return; }
    setBusy(true); setMsg(null); setPreview(null);
    try {
      const res = await fetch('/api/alerts/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, tickers, threshold: threshold / 100, minVolume }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      applySubscription(json.subscription);
      setStatus(current => ({ ...current, emailConfigured: json.emailConfigured }));
      setMsg({ kind: 'ok', text: `Subscribed. You'll be emailed when call or put volume jumps ≥ ${threshold}% and ≥ ${fmt(minVolume)} contracts for ${tickers.join(', ')}.` });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  }

  async function unsubscribe() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusy(true); setMsg(null); setPreview(null);
    try {
      const res = await fetch('/api/alerts/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setSubscription(null);
      setMsg({ kind: 'ok', text: 'Unsubscribed. You will no longer receive alerts.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  }

  async function checkNow() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusy(true); setMsg(null); setPreview(null);
    try {
      const res = await fetch('/api/alerts/check-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPreview(json);
      const failed = Object.keys(json.errors ?? {});
      const failureSuffix = failed.length ? ` Could not check: ${failed.join(', ')}.` : '';
      if (json.triggeredTickers?.length) {
        setMsg({
          kind: 'ok',
          text: json.sent
            ? `Surge detected on ${json.triggeredTickers.join(', ')} — email sent to ${cleanEmail}.${failureSuffix}`
            : `Surge detected on ${json.triggeredTickers.join(', ')}, but email was not sent (${json.reason ?? 'delivery unavailable'}).${failureSuffix}`,
        });
      } else if (failed.length && !json.rows?.length) {
        setMsg({ kind: 'err', text: `The volume check failed for ${failed.join(', ')}. Try again in a moment.` });
      } else {
        setMsg({ kind: failed.length ? 'err' : 'ok', text: `Checked — no large volume increase right now. See today vs prior session below.${failureSuffix}` });
      }
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  }

  async function sendTestEmail() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/alerts/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg({ kind: 'ok', text: `Test email sent to ${cleanEmail}.` });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message });
    } finally { setBusy(false); }
  }

  return (
    <div className="alerts-page">
      <div className="alerts-hero">
        <div className="alerts-hero-icon"><BellIcon /></div>
        <h2>Options Volume Alerts</h2>
        <p>
          Get an email whenever call or put volume spikes for the tickers you care about.
          Each alert shows yesterday's vs today's call and put volume so you can see the jump at a glance.
        </p>
      </div>

      {status && !status.emailConfigured && (
        <div className="alerts-note warn">
          ⚠ Email delivery isn't configured on the server yet (SMTP env vars unset). You can still subscribe and
          preview alerts with <strong>Check now</strong>, but emails won't send until SMTP is set up.
        </div>
      )}
      {status?.emailConfigured && status.emailVerified === false && (
        <div className="alerts-note err">
          Email settings are present, but the server could not connect or authenticate with SMTP. Check the server log and credentials.
        </div>
      )}

      <form className="alerts-form" onSubmit={subscribe}>
        <label className="alerts-field">
          <span className="alerts-label">Email address</span>
          <div className="alerts-email-row">
            <input
              className="alerts-input"
              type="email"
              value={email}
              onChange={e => changeEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              spellCheck={false}
            />
            <button type="button" className="alerts-btn ghost" onClick={lookup} disabled={busy || !email.trim()}>
              Load existing
            </button>
          </div>
        </label>

        <label className="alerts-field">
          <span className="alerts-label">Tickers to watch</span>
          <input
            className="alerts-input"
            value={tickerInput}
            onChange={e => setTickers(e.target.value.toUpperCase())}
            placeholder="Comma-separated — NVDA, AMD, TSLA, SPY…"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="characters"
          />
        </label>

        <label className="alerts-field">
          <span className="alerts-label">
            Alert threshold — notify when volume rises at least <strong>{threshold}%</strong> day-over-day
          </span>
          <input
            className="alerts-range"
            type="range"
            min="10" max="300" step="5"
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
          />
        </label>

        <label className="alerts-field">
          <span className="alerts-label">
            Minimum absolute increase — require at least <strong>{fmt(minVolume)} contracts</strong>
          </span>
          <input
            className="alerts-number"
            type="number"
            min="0"
            step="100"
            value={minVolume}
            onChange={e => setMinVolume(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>

        <div className="alerts-actions">
          <button type="submit" className="alerts-btn primary" disabled={busy}>
            {subscription ? 'Update subscription' : 'Subscribe'}
          </button>
          <button type="button" className="alerts-btn" onClick={checkNow} disabled={busy || !subscription}>
            Check now
          </button>
          <button type="button" className="alerts-btn" onClick={sendTestEmail} disabled={busy || !subscription || !status?.emailConfigured}>
            Send test email
          </button>
          {subscription && (
            <button type="button" className="alerts-btn danger" onClick={unsubscribe} disabled={busy}>
              Unsubscribe
            </button>
          )}
        </div>
      </form>

      {msg && <div className={`alerts-note ${msg.kind === 'err' ? 'err' : 'ok'}`}>{msg.text}</div>}

      {subscription && (
        <div className="alerts-sub-summary">
          Watching <strong>{subscription.tickers.join(', ')}</strong> · threshold ≥ {Math.round((subscription.threshold ?? 0.5) * 100)}%
          {' '}and ≥ {fmt(subscription.minVolume ?? 1000)} contracts
          {subscription.lastNotifiedAt && ` · last emailed ${new Date(subscription.lastNotifiedAt).toLocaleString()}`}
        </div>
      )}

      {preview?.rows?.length > 0 && (
        <div className="alerts-preview">
          <h3 className="alerts-preview-title">Today vs prior session — total contract volume (same nearest-expiration chain)</h3>
          <div className="alerts-table-wrap">
            <table className="alerts-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Calls (vol)</th>
                  <th>Puts (vol)</th>
                  <th>Prior session</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map(r => <PreviewRow key={r.ticker} row={r} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
