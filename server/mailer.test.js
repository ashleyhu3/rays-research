'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const nodemailer = require('nodemailer');
const mailer = require('./mailer');

const originalCreateTransport = nodemailer.createTransport;
const envKeys = [
  'ALERT_EMAIL_PROVIDER',
  'BREVO_API_KEY',
  'BREVO_FROM_EMAIL',
  'BREVO_FROM_NAME',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASS',
  'ALERT_FROM_EMAIL',
];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const originalFetch = global.fetch;

afterEach(() => {
  nodemailer.createTransport = originalCreateTransport;
  for (const key of envKeys) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  global.fetch = originalFetch;
  mailer.resetForTests();
});

test('reports an unconfigured transport without attempting delivery', async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.BREVO_API_KEY;

  assert.deepEqual(await mailer.verify(), {
    configured: false,
    verified: false,
    error: 'SMTP not configured',
    provider: 'SMTP',
  });
  const result = await mailer.sendMail({
    to: 'person@example.com',
    subject: 'Test',
    text: 'Hello',
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'SMTP not configured');
});

test('verifies SMTP and sends with the configured sender', async () => {
  Object.assign(process.env, {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_USER: 'mailer@example.com',
    SMTP_PASS: 'secret',
    ALERT_FROM_EMAIL: 'SIGNAL <alerts@example.com>',
  });

  let transportOptions;
  let message;
  nodemailer.createTransport = options => {
    transportOptions = options;
    return {
      verify: async () => true,
      sendMail: async value => {
        message = value;
        return { messageId: 'message-123' };
      },
    };
  };
  mailer.resetForTests();

  assert.deepEqual(await mailer.verify({ force: true }), {
    configured: true,
    verified: true,
    error: null,
    provider: 'SMTP',
  });
  const result = await mailer.sendMail({
    to: 'person@example.com',
    subject: 'Test',
    text: 'Hello',
  });

  assert.equal(transportOptions.secure, true);
  assert.equal(transportOptions.port, 465);
  assert.equal(message.from, 'SIGNAL <alerts@example.com>');
  assert.equal(message.to, 'person@example.com');
  assert.deepEqual(result, { sent: true, messageId: 'message-123' });
});

test('sends through Brevo when a transactional API key is configured', async () => {
  Object.assign(process.env, {
    ALERT_EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib-secret',
    ALERT_FROM_EMAIL: 'SIGNAL Alerts <alerts@example.com>',
  });

  const requests = [];
  global.fetch = async (url, options) => {
    const request = { url, options, body: options.body ? JSON.parse(options.body) : null };
    requests.push(request);
    if (url === 'https://api.brevo.com/v3/account') {
      return { ok: true, status: 200, text: async () => '{}' };
    }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ messageId: '<brevo-123@example.com>' }),
    };
  };
  mailer.resetForTests();

  assert.deepEqual(await mailer.verify({ force: true }), {
    configured: true,
    verified: true,
    error: null,
    provider: 'Brevo',
  });
  const result = await mailer.sendMail({
    to: 'person@example.com',
    subject: 'Test',
    text: 'Hello',
    html: '<p>Hello</p>',
  });

  const request = requests.find(item => item.url === 'https://api.brevo.com/v3/smtp/email');
  assert.ok(request);
  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.headers['api-key'], 'xkeysib-secret');
  assert.deepEqual(request.body.sender, { email: 'alerts@example.com', name: 'SIGNAL Alerts' });
  assert.deepEqual(request.body.to, [{ email: 'person@example.com' }]);
  assert.equal(request.body.subject, 'Test');
  assert.equal(request.body.textContent, 'Hello');
  assert.equal(request.body.htmlContent, '<p>Hello</p>');
  assert.deepEqual(result, { sent: true, messageId: '<brevo-123@example.com>' });
});

test('uses explicit Brevo sender env values when present', async () => {
  Object.assign(process.env, {
    ALERT_EMAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'xkeysib-secret',
    BREVO_FROM_EMAIL: 'verified@example.com',
    BREVO_FROM_NAME: 'Verified Sender',
    ALERT_FROM_EMAIL: 'Ignored <ignored@example.com>',
  });

  let body;
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, status: 201, text: async () => '{}' };
  };
  mailer.resetForTests();

  await mailer.sendMail({ to: 'person@example.com', subject: 'Test', text: 'Hello' });

  assert.deepEqual(body.sender, { email: 'verified@example.com', name: 'Verified Sender' });
});
