'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const storage = require('./storage');

test('reads and writes one latestSnapshots field instead of the whole blob', async t => {
  const originalReadField = storage.readField;
  const originalWriteField = storage.writeField;
  const calls = [];

  storage.readField = async (name, file, field) => {
    calls.push(['read', name, field, file]);
    return { data: { ok: true }, fetchedAt: 123 };
  };
  storage.writeField = (name, file, field, value) => {
    calls.push(['write', name, field, file, value]);
  };
  t.after(() => {
    storage.readField = originalReadField;
    storage.writeField = originalWriteField;
  });

  delete require.cache[require.resolve('./snapshotStore')];
  const snapshots = require('./snapshotStore');
  assert.deepEqual(await snapshots.latest('commodities'), { data: { ok: true }, fetchedAt: 123 });
  snapshots.put('macro', { value: 7 });

  assert.deepEqual(calls.map(call => call.slice(0, 3)), [
    ['read', 'latestSnapshots', 'commodities'],
    ['write', 'latestSnapshots', 'macro'],
  ]);
  assert.deepEqual(calls[1][4].data, { value: 7 });
  assert.equal(typeof calls[1][4].fetchedAt, 'number');
});

test('seedKeys hydrates only the requested sources', async t => {
  const originalReadField = storage.readField;
  const requested = [];
  storage.readField = async (_name, _file, field) => {
    requested.push(field);
    return field === 'macro' ? { data: { rows: 2 }, fetchedAt: 456 } : null;
  };
  t.after(() => { storage.readField = originalReadField; });

  delete require.cache[require.resolve('./snapshotStore')];
  const snapshots = require('./snapshotStore');
  const writes = [];
  const cache = { set: (...args) => writes.push(args) };
  const seeded = await snapshots.seedKeys(cache, ['macro', 'commodities'], { macro: 9000 });

  assert.deepEqual(requested.sort(), ['commodities', 'macro']);
  assert.deepEqual(seeded, ['macro']);
  assert.deepEqual(writes, [['macro', { rows: 2 }, 9000, 456]]);
});
