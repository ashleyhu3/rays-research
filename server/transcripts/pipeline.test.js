'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFullPipeline } = require('./pipeline');

test('stored-source analysis fails clearly when a pasted transcript was not saved', async () => {
  const events = [];
  await assert.rejects(
    runFullPipeline(
      { ticker: 'NOFILEXYZ', quarter: 'Q2', year: 2026, source: 'stored' },
      event => events.push(event),
    ),
    /No stored transcript found for NOFILEXYZ 2026Q2/,
  );
  assert.equal(events[0].stage, 'collect');
  assert.match(events[0].message, /Loading pasted transcript/);
});
