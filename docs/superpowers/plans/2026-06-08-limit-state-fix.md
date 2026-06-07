# 429 Limit-State Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the 5h limit is exhausted (HTTP 429), show the real maxed-out state (≈100%, red, countdown to reset) instead of freezing on the last value.

**Architecture:** Extract the HTTP-status → `FetchResult` decision out of the `https` callback into a pure, unit-testable function `classifyResponse()`. Add a 429 branch there that parses the rate-limit headers the 429 still carries (same as a 2xx). `fetchRateInfo` calls the pure function; all rendering is unchanged because `pickColorId` already forces red on `status === 'rejected'`.

**Tech Stack:** TypeScript, Node built-in `https`/`fs`, `node:test`. Tests run against compiled `out/*.js` via `npm test` (which compiles first).

---

### Task 1: Extract `classifyResponse` and add the 429 branch

**Files:**
- Modify: `src/api.ts` (add `classifyResponse`, call it from `fetchRateInfo`)
- Test: `test/api.test.js`

Context: `FetchResult` is already defined in `src/api.ts:33-35`:
```ts
export type FetchResult =
  | { ok: true; info: RateInfo }
  | { ok: false; kind: 'noauth' | 'expired' | 'offline' };
```
`parseRateHeaders` is imported from `./logic` at `src/api.ts:5`. Tests import compiled code from `../out/api.js`. `npm test` compiles before running, so no manual `tsc` step is needed.

- [ ] **Step 1: Write the failing tests**

Append to `test/api.test.js`:

```js
const { classifyResponse } = require('../out/api.js');

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `classifyResponse` is `undefined` / not a function (the new tests error; existing tests still pass).

- [ ] **Step 3: Add `classifyResponse` to `src/api.ts`**

Add this exported function immediately after the `FetchResult` type (after `src/api.ts:35`):

```ts
export function classifyResponse(
  status: number,
  headers: Record<string, string | string[] | undefined>
): FetchResult {
  if (status === 401) {
    return { ok: false, kind: 'expired' };
  }
  // A 429 (limit reached) still carries the unified rate-limit headers, so we
  // parse it exactly like a 2xx and let the renderer show the rejected state.
  if ((status >= 200 && status < 300) || status === 429) {
    return { ok: true, info: parseRateHeaders(headers) };
  }
  return { ok: false, kind: 'offline' };
}
```

- [ ] **Step 4: Call it from `fetchRateInfo`**

Replace the `res.on('end', …)` body in `src/api.ts` (currently `src/api.ts:65-74`):

```ts
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status === 401) {
            resolve({ ok: false, kind: 'expired' });
          } else if (status >= 200 && status < 300) {
            resolve({ ok: true, info: parseRateHeaders(res.headers) });
          } else {
            resolve({ ok: false, kind: 'offline' });
          }
        });
```

with:

```ts
        res.on('end', () => {
          resolve(classifyResponse(res.statusCode ?? 0, res.headers));
        });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all new `classifyResponse` tests pass, all existing `api`/`logic` tests still pass. (`npm test` compiles first, so a TypeScript error fails the run.)

- [ ] **Step 6: Commit**

```bash
git add src/api.ts test/api.test.js
git commit -m "fix: show real 100% rejected state when 5h limit is hit (429)"
```

---

## Notes

- No change to `src/extension.ts` or `src/logic.ts`. `renderOk()` → `pickColorId()` already returns `charts.red` for `fiveHourStatus === 'rejected'`, and `buildBarText` renders `$(pulse) 100% · <countdown>`.
- 5xx, 529, and network/timeout errors remain `offline` (stale last value), which is the correct behaviour for a transient outage.
- Manual check (optional, requires being rate-limited): poll while the 5h window is exhausted → `$(pulse) 100% · <countdown>` in red, tooltip `status: rejected`; after reset, next poll recovers automatically.
