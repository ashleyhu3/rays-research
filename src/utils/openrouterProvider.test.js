import test from 'node:test';
import assert from 'node:assert/strict';
import { orModelDailySeries, orProviderDailyModels } from './openrouterProvider.js';
import { buildDailyModelMix } from './companyRevenue.js';

const ranks = {
  dailyLabels: ['2026-07-18', '2026-07-19', '2026-07-20'],
  providerDaily: { Anthropic: [100, 100, 100] },
  providerModelDaily: {
    Anthropic: [
      { slug: 'anthropic/claude-haiku-4.5', name: 'claude-haiku-4.5', tokens: [80, 50, 20] },
      { slug: 'anthropic/claude-opus-4.8', name: 'claude-opus-4.8', tokens: [20, 50, 80] },
    ],
  },
};

const liveData = {
  openrouter: {
    models: [
      { id: 'anthropic/claude-haiku-4.5', pricing: { prompt: 1 } },
      { id: 'anthropic/claude-opus-4.8', pricing: { prompt: 5 } },
    ],
  },
};

test('daily provider series retains model stacks at native cadence', () => {
  const result = orProviderDailyModels(ranks, 'Anthropic', 1);
  assert.deepEqual(result.isoDates, ranks.dailyLabels);
  assert.equal(result.models.length, 2);
  assert.deepEqual(result.tokens, [100, 100, 100]);
});

test('daily blended token price moves with the observed model mix', () => {
  const result = buildDailyModelMix(ranks, liveData, 'Anthropic', 1);
  assert.deepEqual(result.price, [1.8, 3, 4.2]);
});

test('missing live prices create gaps instead of a fabricated flat line', () => {
  const result = buildDailyModelMix(ranks, {}, 'Anthropic', 1);
  assert.deepEqual(result.price, [null, null, null]);
});

test('model history starts at first usage and preserves discontinuities as gaps', () => {
  const modelRanks = {
    dailyLabels: ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'],
    providerModelDaily: {
      Anthropic: [{
        slug: 'anthropic/claude-5-fable-20260609',
        name: 'claude-5-fable',
        tokens: [0, 0, 12, 0, 20],
      }],
    },
  };
  const result = orModelDailySeries(modelRanks, 'Anthropic', 'claude-5-fable');
  assert.deepEqual(result.isoDates, ['2026-06-10', '2026-06-11', '2026-06-12']);
  assert.deepEqual(result.tokens, [12, null, 20]);
});
