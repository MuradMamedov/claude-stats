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
