# Model Selection Setting + Model-Not-Available Error Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user configure which model the status-bar polling request uses, and show a clear, distinct error when the configured model is invalid/unavailable instead of the generic offline state.

**Architecture:** `src/api.ts` gains a `model` parameter on `fetchRateInfo` and a new `modelError` result kind on `classifyResponse` (detected by parsing the JSON error body on 400/404 responses). `src/extension.ts` reads a new `claudeStats.model` setting, passes it through, and renders the new error kind. `package.json` and `README.md` document the setting.

**Tech Stack:** TypeScript, VS Code extension API, Node's built-in `https`/`node:test`.

## Global Constraints

- Existing `classifyResponse(status, headers)` call sites/tests (no `body` arg) must keep compiling and passing — `body` is an optional parameter defaulting to `''`.
- No fallback to cached `lastInfo` for the new `modelError` state — always show the error until the user fixes the setting (per spec, unlike `offline` which shows stale cached %).
- No enum/dropdown for the model setting — plain free-text string.
- Spec: `docs/superpowers/specs/2026-07-25-model-selection-design.md`.

---

### Task 1: `classifyResponse` model-error detection + `fetchRateInfo` model param

**Files:**
- Modify: `src/api.ts:33-93`
- Test: `test/api.test.js`

**Interfaces:**
- Produces: `FetchResult` type now includes `{ ok: false; kind: 'modelError'; message: string }`.
- Produces: `classifyResponse(status: number, headers: HeaderBag, body?: string): FetchResult` — `body` optional, default `''`.
- Produces: `fetchRateInfo(credentialsPath: string, model: string): Promise<FetchResult>` — `model` is now a required second parameter (previously hardcoded inside the function).

- [ ] **Step 1: Write the failing tests**

Add to `test/api.test.js`, after the existing `classifyResponse: 0 (no status) is offline` test:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run compile && node --test "test/*.test.js"`
Expected: compile succeeds (no type changes yet, `body` arg just ignored by JS at runtime), but the new `modelError` tests FAIL — `classifyResponse` currently returns `{ ok: false, kind: 'offline' }` for every non-2xx/401/429 status, so the `assert.deepStrictEqual` calls expecting `kind: 'modelError'` fail.

- [ ] **Step 3: Implement `classifyResponse` model-error detection and `fetchRateInfo` model param**

Replace lines 33-93 of `src/api.ts` (from `export type FetchResult` through the end of `fetchRateInfo`) with:

```ts
export type FetchResult =
  | { ok: true; info: RateInfo }
  | { ok: false; kind: 'noauth' | 'expired' | 'offline' }
  | { ok: false; kind: 'modelError'; message: string };

function parseModelError(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const err = (parsed as { error?: { type?: string; message?: string } }).error;
  if (!err || typeof err.message !== 'string') {
    return undefined;
  }
  if (err.type === 'not_found_error' || /model/i.test(err.message)) {
    return err.message;
  }
  return undefined;
}

export function classifyResponse(
  status: number,
  headers: Record<string, string | string[] | undefined>,
  body: string = ''
): FetchResult {
  if (status === 401) {
    return { ok: false, kind: 'expired' };
  }
  // A 429 (limit reached) still carries the unified rate-limit headers, so we
  // parse it exactly like a 2xx and let the renderer show the rejected state.
  if ((status >= 200 && status < 300) || status === 429) {
    return { ok: true, info: parseRateHeaders(headers) };
  }
  if (status === 400 || status === 404) {
    const message = parseModelError(body);
    if (message) {
      return { ok: false, kind: 'modelError', message };
    }
  }
  return { ok: false, kind: 'offline' };
}

export function fetchRateInfo(credentialsPath: string, model: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const creds = readCredentials(credentialsPath);
    if (!creds?.accessToken) {
      resolve({ ok: false, kind: 'noauth' });
      return;
    }
    const body = JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }]
    });
    const req = https.request(
      {
        host: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${creds.accessToken}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
          'content-length': Buffer.byteLength(body)
        }
      },
      (res) => {
        // Buffer the body (tiny even on error) so classifyResponse can pull
        // model-error detail out of 400/404 error payloads.
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          resolve(classifyResponse(res.statusCode ?? 0, res.headers, rawBody));
        });
      }
    );
    req.on('error', () => resolve({ ok: false, kind: 'offline' }));
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      // Abort a stalled socket; the 'error' handler resolves it offline.
      req.destroy(new Error('request timed out'));
    });
    req.write(body);
    req.end();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run compile && node --test "test/*.test.js"`
Expected: all tests PASS, including the 5 new ones and every pre-existing `test/api.test.js` / `test/logic.test.js` test.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts test/api.test.js
git commit -m "feat(api): detect model-not-available errors, make polling model configurable"
```

---

### Task 2: Wire `claudeStats.model` setting through `extension.ts`

**Files:**
- Modify: `src/extension.ts:57-114`

**Interfaces:**
- Consumes: `fetchRateInfo(credentialsPath: string, model: string): Promise<FetchResult>` and `FetchResult`'s `modelError` kind from Task 1.
- Produces: `config()` return type now includes `model: string`.

- [ ] **Step 1: Add `model` to `config()`**

In `src/extension.ts`, replace the `config()` function (lines 57-65):

```ts
function config() {
  const c = vscode.workspace.getConfiguration('claudeStats');
  return {
    pollIntervalMinutes: c.get<number>('pollIntervalMinutes', 5),
    pauseWhenUnfocused: c.get<boolean>('pauseWhenUnfocused', true),
    greenBelow: c.get<number>('greenBelow', 70),
    yellowBelow: c.get<number>('yellowBelow', 90),
    model: c.get<string>('model', 'claude-haiku-4-5-20251001')
  };
}
```

- [ ] **Step 2: Pass the model through and handle `modelError` in `doPoll()`**

Replace `doPoll()` (lines 88-114):

```ts
async function doPoll(): Promise<void> {
  const cfg = config();
  if (cfg.pauseWhenUnfocused && !vscode.window.state.focused && lastInfo) {
    return;
  }
  const result = await fetchRateInfo(defaultCredentialsPath(), cfg.model);
  if (result.ok) {
    lastInfo = result.info;
    renderOk();
    return;
  }
  switch (result.kind) {
    case 'noauth':
      renderError('$(warning) Claude —', 'Not logged in — no Claude credentials found.');
      return;
    case 'expired':
      renderError('$(warning) Claude —', 'Token expired — run Claude Code to refresh.');
      return;
    case 'offline':
      renderOffline();
      return;
    case 'modelError':
      renderError(
        '$(warning) Claude —',
        `Model "${cfg.model}" not available — ${result.message}. Check the "claudeStats.model" setting.`
      );
      return;
    default: {
      const _exhaustive: never = result.kind;
      throw new Error(`unhandled fetch error: ${String(_exhaustive)}`);
    }
  }
}
```

- [ ] **Step 3: Compile and run the full test suite**

Run: `npm run compile && node --test "test/*.test.js"`
Expected: compiles with no type errors (the `default` branch's exhaustiveness check confirms all four `kind` values are handled), all existing tests still PASS. There are no unit tests for `extension.ts` itself (it's VS Code glue code with no prior test coverage) — compilation success plus the Task 1 tests are the verification for this task.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat(extension): read claudeStats.model setting, render model-not-available errors"
```

---

### Task 3: Declare the setting in `package.json` and document it in `README.md`

**Files:**
- Modify: `package.json:47-69`
- Modify: `README.md`

**Interfaces:**
- Consumes: setting key `claudeStats.model` read by `config()` in Task 2.

- [ ] **Step 1: Add the setting to `package.json`**

In `package.json`, inside `contributes.configuration.properties`, add a new entry after `claudeStats.yellowBelow` (before the closing braces at line 69):

```json
        "claudeStats.model": {
          "type": "string",
          "default": "claude-haiku-4-5-20251001",
          "description": "Model used for the lightweight polling request. Must be a model id your account can access — an invalid or unavailable model shows as an error in the status bar instead of usage data."
        }
```

(Remember to add a trailing comma after the existing `claudeStats.yellowBelow` block's closing `}` since this entry follows it.)

- [ ] **Step 2: Validate `package.json` is well-formed JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('ok')"`
Expected: prints `ok` with no errors.

- [ ] **Step 3: Update `README.md` settings table**

In `README.md`, in the `## Settings` table, add a row after the `claudeStats.yellowBelow` row:

```markdown
| `claudeStats.model` | `claude-haiku-4-5-20251001` | Model used for the polling request. An invalid/unavailable model id shows as a status-bar error instead of usage data. |
```

- [ ] **Step 4: Update `README.md` status bar states table and cost note**

In the `## Status bar states` table, update the `$(warning) Claude —` row to mention the new cause:

```markdown
| `$(warning) Claude —` | Not logged in, token expired, configured model unavailable, or API unreachable with no cached value. Hover for the reason. |
```

In the `## How it gets the data` section's cost-note paragraph, change:

```markdown
**Cost note:** each refresh is one tiny request (Haiku, 1 output token —
negligible), but it does count toward your own 5-hour window. Refreshes happen
```

to:

```markdown
**Cost note:** each refresh is one tiny request (Haiku by default, 1 output
token — negligible), but it does count toward your own 5-hour window. The
model is configurable via `claudeStats.model`. Refreshes happen
```

- [ ] **Step 5: Compile and run the full test suite one more time**

Run: `npm run compile && node --test "test/*.test.js"`
Expected: all tests PASS (docs/config-only changes shouldn't affect this, but confirms nothing regressed).

- [ ] **Step 6: Commit**

```bash
git add package.json README.md
git commit -m "docs: document claudeStats.model setting"
```
