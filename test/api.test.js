const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readCredentials } = require('../out/api.js');

function tmpFile(contents) {
  const p = path.join(os.tmpdir(), `creds-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(p, contents);
  return p;
}

test('readCredentials returns the oauth block', () => {
  const p = tmpFile(JSON.stringify({
    claudeAiOauth: { accessToken: 'tok123', refreshToken: 'r', expiresAt: 1 }
  }));
  const creds = readCredentials(p);
  assert.strictEqual(creds.accessToken, 'tok123');
  fs.unlinkSync(p);
});

test('readCredentials returns null when file is missing', () => {
  assert.strictEqual(readCredentials('/no/such/file.json'), null);
});

test('readCredentials returns null on malformed json', () => {
  const p = tmpFile('{ not json');
  assert.strictEqual(readCredentials(p), null);
  fs.unlinkSync(p);
});
