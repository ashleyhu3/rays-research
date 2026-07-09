'use strict';
const store  = require('./alertsStore');
const mailer = require('./mailer');
const { getOptionsData } = require('./scrapers/options');

// ── Options-volume alert engine ─────────────────────────────────────────────
// Once per run it fetches each watched ticker's nearest-expiration chain, sums
// call and put contract volume, and compares that "today" figure against the
// most recent prior day it recorded. When either side jumps by more than a
// subscriber's threshold (and clears an absolute floor), that subscriber gets
// an email showing yesterday's vs today's call/put volume for every triggered
// ticker. Designed to run daily after the close, but also on-demand from the
// Alerts page's "Check now" button.

function sumVolume(contracts) {
  return (contracts || []).reduce((sum, c) => sum + (c.volume || 0), 0);
}

// Nearest-expiration chain, matching what the Options page & warmOptions use.
// Most flow concentrates in the front expiration, so its call/put totals are a
// good proxy for "how heavily is this name being traded today".
async function fetchTickerVolumes(ticker) {
  const data = await getOptionsData(ticker);
  return {
    date:       store.today(),
    callVol:    sumVolume(data.calls),
    putVol:     sumVolume(data.puts),
    price:      data.price ?? null,
    expiration: data.selectedDate ?? null,
  };
}

// A single side (calls or puts) counts as a "large increase" when the day-over-
// day jump clears BOTH an absolute floor (minVolume, kills noise on thin names)
// AND a relative threshold (e.g. 0.5 → today ≥ 1.5× yesterday).
function sideTrigger(todayVol, prevVol, threshold, minVolume) {
  const t = todayVol || 0;
  const p = prevVol  || 0;
  if (t - p < minVolume) return false;      // require a meaningful absolute jump
  if (p <= 0)            return t >= minVolume; // no prior volume → any real activity
  return t >= p * (1 + threshold);           // relative jump beyond threshold
}

function pctChange(todayVol, prevVol) {
  const t = todayVol || 0;
  const p = prevVol  || 0;
  if (p <= 0) return t > 0 ? null : 0;       // null → "new" (no baseline to divide by)
  return ((t - p) / p) * 100;
}

// Build the per-ticker comparison rows for one subscription against the shared
// stats map. Each row carries today's + yesterday's totals and whether either
// side triggered under this subscriber's sensitivity.
function buildRows(sub, stats) {
  const rows = [];
  for (const ticker of sub.tickers) {
    const stat = stats[ticker];
    if (!stat) continue; // fetch failed for this ticker
    const { today, prev } = stat;
    const hasBaseline = Boolean(prev);
    const call = hasBaseline && sideTrigger(today.callVol, prev.callVol, sub.threshold, sub.minVolume);
    const put  = hasBaseline && sideTrigger(today.putVol,  prev.putVol,  sub.threshold, sub.minVolume);
    rows.push({
      ticker,
      today,
      prev: prev || null,
      hasBaseline,
      call: Boolean(call),
      put:  Boolean(put),
      callPct: prev ? pctChange(today.callVol, prev.callVol) : null,
      putPct:  prev ? pctChange(today.putVol,  prev.putVol)  : null,
    });
  }
  return rows;
}

function fmt(n)  { return (n || 0).toLocaleString('en-US'); }
function fmtPct(p) {
  if (p == null) return 'new';
  const sign = p >= 0 ? '+' : '';
  return `${sign}${p.toFixed(0)}%`;
}

// ── Email rendering ─────────────────────────────────────────────────────────

function buildEmail(triggeredRows) {
  const tickers = triggeredRows.map(r => r.ticker);
  const subject = `Options volume alert — ${tickers.join(', ')}`;

  // Plain-text fallback.
  const textLines = ['Large options-volume increase detected:', ''];
  for (const r of triggeredRows) {
    const py = r.prev ? r.prev.date : 'n/a';
    textLines.push(`${r.ticker}  (prior session ${py} → today ${r.today.date})`);
    const cflag = r.call ? '  ⚠ CALL SURGE' : '';
    const pflag = r.put  ? '  ⚠ PUT SURGE'  : '';
    textLines.push(`  Calls:  ${fmt(r.prev?.callVol)} → ${fmt(r.today.callVol)}  (${fmtPct(r.callPct)})${cflag}`);
    textLines.push(`  Puts:   ${fmt(r.prev?.putVol)} → ${fmt(r.today.putVol)}  (${fmtPct(r.putPct)})${pflag}`);
    textLines.push('');
  }
  textLines.push('You are receiving this because you subscribed to options alerts on SIGNAL.');
  const text = textLines.join('\n');

  // HTML — inline styles for broad email-client support.
  const rowsHtml = triggeredRows.map(r => {
    const cellCall = sideCells(r.prev?.callVol, r.today.callVol, r.callPct, r.call, '#0a8f5b');
    const cellPut  = sideCells(r.prev?.putVol,  r.today.putVol,  r.putPct,  r.put,  '#c0392b');
    return `
      <tr>
        <td style="padding:12px 14px;border-bottom:1px solid #eee;font-weight:700;font-size:15px;">${r.ticker}
          ${r.today.price != null ? `<div style="font-weight:400;color:#888;font-size:12px;">$${Number(r.today.price).toFixed(2)}</div>` : ''}
        </td>
        <td style="padding:12px 14px;border-bottom:1px solid #eee;">Calls${r.call ? badge('#0a8f5b', 'SURGE') : ''}<br>${cellCall}</td>
        <td style="padding:12px 14px;border-bottom:1px solid #eee;">Puts${r.put ? badge('#c0392b', 'SURGE') : ''}<br>${cellPut}</td>
      </tr>`;
  }).join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;color:#1a1a1a;">
    <div style="padding:20px 0;border-bottom:2px solid #10b981;">
      <span style="font-size:20px;font-weight:800;letter-spacing:.04em;">SIGNAL</span>
      <span style="color:#888;font-size:13px;"> · Options volume alert</span>
    </div>
    <p style="font-size:14px;line-height:1.5;color:#444;">
      A large day-over-day increase in call or put volume was detected for the ticker(s) you're watching.
      Below is the prior session vs today's total contract volume (same nearest-expiration chain).
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="text-align:left;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.05em;">
          <th style="padding:8px 14px;border-bottom:1px solid #ddd;">Ticker</th>
          <th style="padding:8px 14px;border-bottom:1px solid #ddd;">Calls (vol)</th>
          <th style="padding:8px 14px;border-bottom:1px solid #ddd;">Puts (vol)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <p style="font-size:11px;color:#aaa;margin-top:24px;line-height:1.5;">
      "Prior session" is the most recent earlier trading day SIGNAL recorded this same expiration for the ticker.
      You're receiving this because you subscribed to options alerts on SIGNAL.
    </p>
  </div>`;

  return { subject, text, html };
}

function badge(color, label) {
  return `<span style="background:${color};color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:6px;">${label}</span>`;
}

function sideCells(prevVol, todayVol, pct, triggered, color) {
  const weight = triggered ? 700 : 400;
  const pctColor = pct == null ? '#888' : (pct >= 0 ? color : '#888');
  return `<span style="color:#888;">${fmt(prevVol)}</span>
    <span style="color:#bbb;"> → </span>
    <span style="font-weight:${weight};">${fmt(todayVol)}</span>
    <span style="color:${pctColor};font-weight:${weight};"> (${fmtPct(pct)})</span>`;
}

// ── Public entry points ─────────────────────────────────────────────────────

// Run the alert cycle. `onlyEmail` scopes to one subscriber (used by the
// "Check now" button); otherwise every subscriber is evaluated (the daily cron).
// Returns a summary suitable for both logging and the API response, including a
// full per-ticker preview so the UI can show today-vs-yesterday even when
// nothing crossed the threshold.
async function run({ onlyEmail = null, send = true } = {}) {
  const subs = onlyEmail
    ? [store.getSubscription(onlyEmail)].filter(Boolean)
    : store.listSubscriptions();

  const emailConfigured = mailer.isConfigured();
  if (!subs.length) {
    return { subscribers: 0, tickers: [], notifications: [], errors: {}, emailConfigured };
  }

  // Fetch + record each watched ticker exactly once, shared across subscribers.
  const tickers = [...new Set(subs.flatMap(s => s.tickers))];
  const stats = {};
  const errors = {};
  for (const ticker of tickers) {
    try {
      const today = await fetchTickerVolumes(ticker);
      const prev  = store.previousVolume(ticker, today.date, today.expiration);
      store.recordVolume(ticker, today);            // persist today's totals
      stats[ticker] = { today, prev };
    } catch (e) {
      errors[ticker] = e.message;
      console.warn(`[alerts] ${ticker} fetch failed:`, e.message);
    }
  }

  const notifications = [];
  for (const sub of subs) {
    const rows      = buildRows(sub, stats);
    const triggered = rows.filter(r => r.call || r.put);
    const note = {
      email: sub.email,
      triggeredTickers: triggered.map(r => r.ticker),
      rows,                 // full preview for the UI (all their tickers)
      sent: false,
      reason: null,
    };
    if (triggered.length && send) {
      const mail = buildEmail(triggered);
      note.subject = mail.subject;
      const notificationKey = [
        store.today(),
        ...triggered
          .map(row => `${row.ticker}:${row.call ? 'C' : ''}${row.put ? 'P' : ''}`)
          .sort(),
      ].join('|');
      if (sub.lastNotificationKey === notificationKey) {
        note.reason = 'This alert was already sent today.';
        notifications.push(note);
        continue;
      }
      try {
        const res = await mailer.sendMail({ to: sub.email, subject: mail.subject, text: mail.text, html: mail.html });
        note.sent   = res.sent;
        note.reason = res.reason || null;
        if (res.sent) store.markNotified(sub.email, notificationKey);
      } catch (e) {
        note.reason = e.message;
        console.error('[alerts] send failed for', sub.email, e.message);
      }
    }
    notifications.push(note);
  }

  return { subscribers: subs.length, tickers, notifications, errors, emailConfigured };
}

async function sendTestEmail(to) {
  const subject = 'SIGNAL alerts — delivery test';
  const text = [
    'Your SIGNAL options-volume alerts are ready.',
    '',
    'This test confirms that the alert server can deliver email to this address.',
  ].join('\n');
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
    <div style="padding:20px 0;border-bottom:2px solid #10b981;">
      <span style="font-size:20px;font-weight:800;letter-spacing:.04em;">SIGNAL</span>
      <span style="color:#888;font-size:13px;"> · Delivery test</span>
    </div>
    <p style="font-size:14px;line-height:1.6;">Your options-volume alerts are ready.</p>
    <p style="font-size:13px;line-height:1.6;color:#666;">This test confirms that the alert server can deliver email to this address.</p>
  </div>`;
  return mailer.sendMail({ to, subject, text, html });
}

module.exports = { run, sendTestEmail, sideTrigger, sumVolume, fetchTickerVolumes, buildEmail };
