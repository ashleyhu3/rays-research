'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calibrationContract,
  computeFedWatch,
  futuresSymbol,
} = require('./fedWatch');

test('late-month meetings use the following clean contract month', () => {
  const schedule = [
    { date: '2026-09-16', label: 'Sep 15-16, 2026' },
    { date: '2026-10-28', label: 'Oct 27-28, 2026' },
    { date: '2026-12-09', label: 'Dec 8-9, 2026' },
  ];

  assert.deepEqual(calibrationContract(schedule[0], schedule), {
    year: 2026, month: 9, method: 'meeting-month',
  });
  assert.deepEqual(calibrationContract(schedule[1], schedule), {
    year: 2026, month: 11, method: 'clean-post-month',
  });
  assert.equal(futuresSymbol(2026, 11), 'ZQX26.CBT');
});

test('clean post-month calibration does not amplify October over three days', () => {
  const meetings = [
    { date: '2026-07-29', label: 'Jul 28-29, 2026' },
    { date: '2026-09-16', label: 'Sep 15-16, 2026' },
    { date: '2026-10-28', label: 'Oct 27-28, 2026' },
    { date: '2026-12-09', label: 'Dec 8-9, 2026' },
  ];
  const futures = {
    '2026-07-29': {
      symbol: 'ZQQ26.CBT', price: 96.285, date: '2026-07-27',
      calibrationMethod: 'clean-post-month',
    },
    '2026-09-16': {
      symbol: 'ZQU26.CBT', price: 96.21, date: '2026-07-27',
      calibrationMethod: 'meeting-month',
    },
    '2026-10-28': {
      symbol: 'ZQX26.CBT', price: 96.055, date: '2026-07-27',
      calibrationMethod: 'clean-post-month',
    },
    '2026-12-09': {
      symbol: 'ZQZ26.CBT', price: 95.99, date: '2026-07-27',
      calibrationMethod: 'meeting-month',
    },
  };

  const result = computeFedWatch(meetings, 3.63, 3.75, futures);
  const october = result.meetings[2];
  const december = result.meetings[3];

  assert.equal(october.contractSymbol, 'ZQX26.CBT');
  assert.equal(october.calibrationMethod, 'clean-post-month');
  assert.ok(october.expectedMoveBp > 0 && october.expectedMoveBp < 25);
  assert.ok(december.expectedMoveBp > 0 && december.expectedMoveBp < 25);
});
