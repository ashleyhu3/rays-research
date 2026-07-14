'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchChain } = require('./scrapers/options');

test('a failed paginated chain page rejects instead of returning a truncated chain', async t => {
  const originalFetch = global.fetch;
  const originalKey = process.env.MASSIVE_API_KEY;
  const requests = [];
  process.env.MASSIVE_API_KEY = 'test-key';
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) {
      return {
        ok: true,
        json: async () => ({
          results: [{ details: { ticker: 'O:TEST' } }],
          next_url: 'https://api.massive.com/v3/snapshot/options/INTC?cursor=next&apiKey=leaked',
        }),
      };
    }
    return {
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.MASSIVE_API_KEY;
    else process.env.MASSIVE_API_KEY = originalKey;
  });

  await assert.rejects(fetchChain('INTC', '2026-07-17'), /Massive 429/);
  assert.equal(requests.length, 2);
  assert.ok(!requests[1].url.includes('apiKey='), 'pagination strips query-string credentials');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-key');
});
