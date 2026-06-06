const test = require('node:test');
const assert = require('node:assert');
const { parseRateHeaders } = require('../out/logic.js');

test('parseRateHeaders extracts 5h and 7d fields', () => {
  const headers = {
    'anthropic-ratelimit-unified-5h-utilization': '0.38',
    'anthropic-ratelimit-unified-5h-reset': '1780757400',
    'anthropic-ratelimit-unified-5h-status': 'allowed',
    'anthropic-ratelimit-unified-7d-utilization': '0.23',
    'anthropic-ratelimit-unified-7d-reset': '1780905600',
    'anthropic-ratelimit-unified-7d-status': 'allowed_warning'
  };
  const info = parseRateHeaders(headers);
  assert.strictEqual(info.fiveHourUtil, 0.38);
  assert.strictEqual(info.fiveHourReset, 1780757400);
  assert.strictEqual(info.fiveHourStatus, 'allowed');
  assert.strictEqual(info.sevenDayUtil, 0.23);
  assert.strictEqual(info.sevenDayReset, 1780905600);
  assert.strictEqual(info.sevenDayStatus, 'allowed_warning');
});

test('parseRateHeaders accepts array-valued headers and missing fields', () => {
  const info = parseRateHeaders({
    'anthropic-ratelimit-unified-5h-utilization': ['0.5']
  });
  assert.strictEqual(info.fiveHourUtil, 0.5);
  assert.strictEqual(info.fiveHourReset, 0);
  assert.strictEqual(info.fiveHourStatus, 'unknown');
});

const { formatCountdown, formatClock } = require('../out/logic.js');

test('formatCountdown shows hours and padded minutes', () => {
  const now = 1_000_000_000_000;
  const reset = Math.floor(now / 1000) + 2 * 3600 + 14 * 60; // 2h14m ahead
  assert.strictEqual(formatCountdown(reset, now), '2h14m');
});

test('formatCountdown under one hour omits hours', () => {
  const now = 1_000_000_000_000;
  const reset = Math.floor(now / 1000) + 9 * 60; // 9m ahead
  assert.strictEqual(formatCountdown(reset, now), '9m');
});

test('formatCountdown past reset shows now', () => {
  const now = 1_000_000_000_000;
  assert.strictEqual(formatCountdown(Math.floor(now / 1000) - 5, now), 'now');
});

test('formatClock returns HH:MM', () => {
  assert.match(formatClock(1780757400), /^\d{2}:\d{2}$/);
});
