'use strict';
const nodemailer = require('nodemailer');

// Thin wrapper over nodemailer that degrades gracefully — matching the rest of
// the app, where every integration works with its key set and no-ops without.
//
// Configure via env (all optional):
//   SMTP_HOST        e.g. smtp.gmail.com
//   SMTP_PORT        default 587 (or 465 for implicit TLS)
//   SMTP_SECURE      "true" to force implicit TLS (auto-on for port 465)
//   SMTP_USER        SMTP username / sender login
//   SMTP_PASS        SMTP password or app-password
//   ALERT_FROM_EMAIL "Name <addr>" from address (defaults to SMTP_USER)
//
// When host/user/pass aren't all present, isConfigured() is false and send()
// returns { sent:false, reason } after logging a preview — so callers (the
// alert engine, the /check-now endpoint) never crash, and the UI can warn the
// user that delivery is pending SMTP setup.

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function fromAddress() {
  return process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || 'alerts@signal.local';
}

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  const port   = Number(process.env.SMTP_PORT) || 587;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

let verification = { checkedAt: 0, ok: false, error: null };
const VERIFY_TTL = 5 * 60 * 1000;

// Confirm that the server can connect and authenticate, without sending mail.
// Cache the result so opening the Alerts page cannot hammer the SMTP host.
async function verify({ force = false } = {}) {
  if (!isConfigured()) {
    return { configured: false, verified: false, error: 'SMTP not configured' };
  }
  if (!force && Date.now() - verification.checkedAt < VERIFY_TTL) {
    return { configured: true, verified: verification.ok, error: verification.error };
  }
  try {
    await getTransport().verify();
    verification = { checkedAt: Date.now(), ok: true, error: null };
  } catch (error) {
    verification = {
      checkedAt: Date.now(),
      ok: false,
      error: error?.message || 'SMTP verification failed',
    };
  }
  return { configured: true, verified: verification.ok, error: verification.error };
}

// Send one email. Resolves to { sent, reason?, messageId? } and never throws for
// an unconfigured mailer — a genuine SMTP failure still rejects so the caller
// can log it.
async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    console.warn(`[mailer] SMTP not configured — preview only for "${subject}" → ${to}`);
    return { sent: false, reason: 'SMTP not configured' };
  }
  const info = await getTransport().sendMail({ from: fromAddress(), to, subject, text, html });
  return { sent: true, messageId: info.messageId };
}

function resetForTests() {
  transporter = null;
  verification = { checkedAt: 0, ok: false, error: null };
}

module.exports = { isConfigured, sendMail, verify, fromAddress, resetForTests };
