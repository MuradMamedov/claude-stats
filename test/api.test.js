const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCredentials, classifyResponse } = require('../out/api.js');

function tmpFile(contents) {
  const p = path.join(os.tmpdir(), `creds-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(p, contents);
  return p;
}

test('readCredentials returns the oauth block', () => {
  const p = tmpFile(JSON.stringify({
    claudeAiOauth: { accessToken: 'tok123', refreshToken: 'r', expiresAt: 1 }
  }));
  try {
    const creds = readCredentials(p);
    assert.strictEqual(creds.accessToken, 'tok123');
  } finally {
    fs.unlinkSync(p);
  }
});

test('readCredentials returns null when file is missing', () => {
  assert.strictEqual(readCredentials('/no/such/file.json'), null);
});

test('readCredentials returns null on malformed json', () => {
  const p = tmpFile('{ not json');
  try {
    assert.strictEqual(readCredentials(p), null);
  } finally {
    fs.unlinkSync(p);
  }
});

const rlHeaders = {
  'anthropic-ratelimit-unified-5h-utilization': '1',
  'anthropic-ratelimit-unified-5h-reset': '1780757400',
  'anthropic-ratelimit-unified-5h-status': 'rejected',
  'anthropic-ratelimit-unified-7d-utilization': '0.5',
  'anthropic-ratelimit-unified-7d-reset': '1780905600',
  'anthropic-ratelimit-unified-7d-status': 'allowed'
};

test('classifyResponse: 429 parses headers and is ok (limit reached)', () => {
  const r = classifyResponse(429, rlHeaders);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.info.fiveHourStatus, 'rejected');
  assert.strictEqual(r.info.fiveHourUtil, 1);
  assert.strictEqual(r.info.fiveHourReset, 1780757400);
});

test('classifyResponse: 200 parses headers and is ok', () => {
  const r = classifyResponse(200, rlHeaders);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.info.fiveHourStatus, 'rejected');
});

test('classifyResponse: 401 is expired', () => {
  const r = classifyResponse(401, rlHeaders);
  assert.deepStrictEqual(r, { ok: false, kind: 'expired' });
});

test('classifyResponse: 500 is offline (429 branch is not greedy)', () => {
  const r = classifyResponse(500, rlHeaders);
  assert.deepStrictEqual(r, { ok: false, kind: 'offline' });
});

test('classifyResponse: 0 (no status) is offline', () => {
  const r = classifyResponse(0, rlHeaders);
  assert.deepStrictEqual(r, { ok: false, kind: 'offline' });
});

test('classifyResponse: 404 not_found_error body is modelError', () => {
  const body = JSON.stringify({
    type: 'error',
    error: { type: 'not_found_error', message: 'model: claude-bad-id' }
  });
  const r = classifyResponse(404, {}, body);
  assert.deepStrictEqual(r, { ok: false, kind: 'modelError', message: 'model: claude-bad-id' });
});

test('classifyResponse: 400 invalid_request_error mentioning model is modelError', () => {
  const body = JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'model: claude-bad-id is not supported' }
  });
  const r = classifyResponse(400, {}, body);
  assert.deepStrictEqual(r, {
    ok: false,
    kind: 'modelError',
    message: 'model: claude-bad-id is not supported'
  });
});

test('classifyResponse: 404 with unparseable body falls back to offline', () => {
  const r = classifyResponse(404, {}, 'not json');
  assert.deepStrictEqual(r, { ok: false, kind: 'offline' });
});

test('classifyResponse: 404 with unrelated error body falls back to offline', () => {
  const body = JSON.stringify({
    type: 'error',
    error: { type: 'invalid_request_error', message: 'messages: array is too long' }
  });
  const r = classifyResponse(404, {}, body);
  assert.deepStrictEqual(r, { ok: false, kind: 'offline' });
});

test('classifyResponse: 404/400 with no body arg still offline (default param)', () => {
  assert.deepStrictEqual(classifyResponse(404, {}), { ok: false, kind: 'offline' });
  assert.deepStrictEqual(classifyResponse(400, {}), { ok: false, kind: 'offline' });
});

test('classifyResponse: 404 with JSON null body falls back to offline (does not throw)', () => {
  assert.deepStrictEqual(classifyResponse(404, {}, 'null'), { ok: false, kind: 'offline' });
});
