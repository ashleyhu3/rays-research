'use strict';

const path = require('path');
const storage = require('../storage');
const alertsEngine = require('../alertsEngine');
const mailer = require('../mailer');

const ALERTS_BLOB = [{
  name: 'optionsAlerts',
  file: path.join(__dirname, '..', 'data', 'optionsAlerts.json'),
}];

async function main() {
  if (!mailer.isConfigured()) {
    throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASS are required to deliver alerts.');
  }

  const smtp = await mailer.verify({ force: true });
  if (!smtp.verified) throw new Error(`SMTP verification failed: ${smtp.error}`);

  await storage.init(ALERTS_BLOB);
  const summary = await alertsEngine.run();
  await storage.flush();

  const delivered = summary.notifications.filter(item => item.sent).length;
  const triggered = summary.notifications.filter(item => item.triggeredTickers.length > 0).length;
  console.log(JSON.stringify({
    subscribers: summary.subscribers,
    tickersChecked: summary.tickers.length,
    subscribersTriggered: triggered,
    emailsDelivered: delivered,
    tickerErrors: Object.keys(summary.errors),
  }));
}

main()
  .catch(error => {
    console.error('[alerts:run]', error.message);
    process.exitCode = 1;
  })
  .finally(() => storage.close());
