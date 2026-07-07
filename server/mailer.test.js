'use strict';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const nodemailer = require('nodemailer');
const mailer = require('./mailer');

const originalCreateTransport = nodemailer.createTransport;
const envKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'ALERT_FROM_EMAIL'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

afterEach(() => {
  nodemailer.createTransport = originalCreateTransport;
  for (const key of envKeys) {
    if (originalEnv[key] == null) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  mailer.resetForTests();
});

test('reports an unconfigured transport without attempting delivery', async () => {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;

  assert.deepEqual(await mailer.verify(), {
    configured: false,
    verified: false,
    error: 'SMTP not configured',
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
