'use strict';
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Thin wrapper over alert email delivery that degrades gracefully — matching the
// rest of the app, where every integration works with its key set and no-ops
// without.
//
// Configure via env (all optional):
//   ALERT_EMAIL_PROVIDER "brevo" to force Brevo API, "smtp" to force SMTP
//   BREVO_API_KEY        Brevo transactional email API key
//   BREVO_FROM_EMAIL     Verified Brevo sender email (or use ALERT_FROM_EMAIL)
//   BREVO_FROM_NAME      Optional sender display name
//   SMTP_HOST        e.g. smtp.gmail.com
//   SMTP_PORT        default 587 (or 465 for implicit TLS)
//   SMTP_SECURE      "true" to force implicit TLS (auto-on for port 465)
//   SMTP_USER        SMTP username / sender login
//   SMTP_PASS        SMTP password or app-password
//   ALERT_FROM_EMAIL "Name <addr>" from address (defaults to SMTP_USER)
//
// When provider credentials aren't all present, isConfigured() is false and
// send() returns { sent:false, reason } after logging a preview — so callers
// never crash, and the UI can warn the user that delivery is pending setup.

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const BREVO_ACCOUNT_ENDPOINT = 'https://api.brevo.com/v3/account';

function isConfigured() {
  if (provider() === 'brevo') return Boolean(process.env.BREVO_API_KEY && sender().email);
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function provider() {
  const configured = String(process.env.ALERT_EMAIL_PROVIDER || '').trim().toLowerCase();
  if (configured === 'brevo' || configured === 'smtp') return configured;
  return process.env.BREVO_API_KEY ? 'brevo' : 'smtp';
}

function fromAddress() {
  const brevo = process.env.BREVO_FROM_EMAIL;
  if (brevo) {
    const name = process.env.BREVO_FROM_NAME || parseAddress(process.env.ALERT_FROM_EMAIL).name;
    return name ? `${name} <${brevo}>` : brevo;
  }
  return process.env.ALERT_FROM_EMAIL || process.env.SMTP_USER || 'alerts@signal.local';
}

function parseAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^<>@\s]+@[^<>@\s]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^["']|["']$/g, '');
    return { name: name || undefined, email: match[2].trim() };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { email: raw };
  return { name: raw || undefined, email: null };
}

function sender() {
  const parsed = parseAddress(fromAddress());
  return {
    email: parsed.email,
    name: process.env.BREVO_FROM_NAME || parsed.name || undefined,
  };
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
    return { configured: false, verified: false, error: `${providerName()} not configured`, provider: providerName() };
  }
  if (provider() === 'brevo') {
    if (!force && Date.now() - verification.checkedAt < VERIFY_TTL) {
      return { configured: true, verified: verification.ok, error: verification.error, provider: providerName() };
    }
    try {
      await verifyBrevo();
      verification = { checkedAt: Date.now(), ok: true, error: null };
    } catch (error) {
      verification = {
        checkedAt: Date.now(),
        ok: false,
        error: error?.message || 'Brevo verification failed',
      };
    }
    return { configured: true, verified: verification.ok, error: verification.error, provider: providerName() };
  }
  if (!force && Date.now() - verification.checkedAt < VERIFY_TTL) {
    return { configured: true, verified: verification.ok, error: verification.error, provider: providerName() };
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
  return { configured: true, verified: verification.ok, error: verification.error, provider: providerName() };
}

// Send one email. Resolves to { sent, reason?, messageId? } and never throws for
// an unconfigured mailer — a genuine SMTP failure still rejects so the caller
// can log it. Attachments follow Nodemailer's shape; when using Brevo, cid
// attachments are sent as inline images and the rest as normal attachments.
async function sendMail({ to, subject, text, html, attachments = [] }) {
  if (!isConfigured()) {
    console.warn(`[mailer] ${providerName()} not configured — preview only for "${subject}" → ${to}`);
    return { sent: false, reason: `${providerName()} not configured` };
  }
  if (provider() === 'brevo') {
    return sendBrevoMail({ to, subject, text, html, attachments });
  }
  const info = await getTransport().sendMail({ from: fromAddress(), to, subject, text, html, attachments });
  return { sent: true, messageId: info.messageId };
}

async function sendBrevoMail({ to, subject, text, html, attachments = [] }) {
  const from = sender();
  const { inlineImage, attachment } = brevoAttachments(attachments);
  const body = {
    sender: from.name ? { email: from.email, name: from.name } : { email: from.email },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html,
  };
  if (inlineImage.length) body.inlineImage = inlineImage;
  if (attachment.length) body.attachment = attachment;

  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: raw }; }
  if (!response.ok) {
    const detail = payload?.message || payload?.error || response.statusText;
    throw new Error(`Brevo send failed (${response.status}): ${detail}`);
  }
  return { sent: true, messageId: payload?.messageId || null };
}

function brevoAttachments(attachments) {
  const inlineImage = [];
  const attachment = [];

  for (const item of attachments ?? []) {
    const encoded = encodeAttachment(item);
    if (!encoded) continue;
    if (item.cid) inlineImage.push({ content: encoded.content, name: item.cid });
    else attachment.push({ content: encoded.content, name: encoded.name });
  }

  return { inlineImage, attachment };
}

function encodeAttachment(item) {
  if (!item) return null;
  const name = item.filename || (item.path ? path.basename(item.path) : null);
  if (!name && !item.cid) return null;
  let raw = item.content;
  if (raw == null && item.path) raw = fs.readFileSync(item.path);
  if (raw == null) return null;
  const content = Buffer.isBuffer(raw)
    ? raw.toString('base64')
    : Buffer.from(String(raw)).toString('base64');
  return { content, name: name || item.cid };
}

async function verifyBrevo() {
  const response = await fetch(BREVO_ACCOUNT_ENDPOINT, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
  });
  if (!response.ok) {
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { message: raw }; }
    const detail = payload?.message || payload?.error || response.statusText;
    throw new Error(`Brevo verification failed (${response.status}): ${detail}`);
  }
}

function providerName() {
  return provider() === 'brevo' ? 'Brevo' : 'SMTP';
}

function resetForTests() {
  transporter = null;
  verification = { checkedAt: 0, ok: false, error: null };
}

module.exports = { isConfigured, sendMail, verify, fromAddress, providerName, resetForTests };
