# Model selection setting + model-not-available error

## Problem

The extension pings the Anthropic API purely to read the
`anthropic-ratelimit-unified-*` response headers; the model used for that
ping is hardcoded (`claude-haiku-4-5-20251001` in `src/api.ts`). Users have
no way to change it (e.g. to match a model they know is available on their
plan, or to avoid one that isn't). If the hardcoded model ever becomes
invalid or unavailable for a given account, the extension currently
misreports this as a generic offline error, which is confusing and doesn't
point at the real cause.

## Goals

- Let the user configure which model the extension pings with.
- If the configured model is rejected by the API as invalid/unavailable,
  show a distinct, actionable error — not the generic offline state.

## Non-goals

- No dropdown/enum of known models — model names change over time and a
  hardcoded list would go stale. Free-text setting only.
- No client-side validation of the model id before sending — validity is a
  property of the account/API, not something we can determine locally.
- No change to polling cadence, cost-collapsing behavior, or the
  rate-limit-header parsing logic.

## Design

### Setting

Add `claudeStats.model` (string, default `claude-haiku-4-5-20251001`) to
`package.json` configuration. Freeform text; description notes it's used
for the lightweight polling request and that an invalid id will surface as
an error in the status bar.

### `src/api.ts`

- `fetchRateInfo(credentialsPath, model)` — takes the model id as a
  parameter instead of a hardcoded constant, and includes it in the request
  body.
- The response body is now always buffered (in addition to headers). Error
  bodies from this endpoint are tiny, so this has no meaningful cost; success
  bodies are still discarded after buffering (we only need headers there).
- `classifyResponse(status, headers, body = '')` gains a `body` parameter
  (optional, defaults to `''` so existing call sites/tests keep compiling)
  and a new result kind:

  ```ts
  export type FetchResult =
    | { ok: true; info: RateInfo }
    | { ok: false; kind: 'noauth' | 'expired' | 'offline' }
    | { ok: false; kind: 'modelError'; message: string };
  ```

  Classification order:
  1. `401` → `expired` (unchanged).
  2. `2xx` or `429` → `ok`, parse headers (unchanged).
  3. `400` or `404` → attempt `JSON.parse(body)`. If it has the shape
     `{ error: { type, message } }` and either `type === 'not_found_error'`
     or `message` mentions "model" (case-insensitive), return
     `{ ok: false, kind: 'modelError', message: error.message }`.
     Otherwise (unparseable body, or a 400/404 unrelated to the model)
     fall through to `offline`, same as today.
  4. Anything else → `offline` (unchanged).

### `src/extension.ts`

- `config()` reads `claudeStats.model` (default
  `claude-haiku-4-5-20251001`) and passes it to `fetchRateInfo`.
- New `switch` case in `doPoll()`:

  ```ts
  case 'modelError':
    renderError(
      '$(warning) Claude —',
      `Model "${cfg.model}" not available — ${result.message}. Check the "claudeStats.model" setting.`
    );
    return;
  ```

- No fallback to cached `lastInfo` for this state (unlike `offline`) — a bad
  model id won't self-resolve on the next timer tick, so the error should
  stay visible until the user fixes the setting, rather than being masked
  behind a stale percentage.

### Tests

- `test/api.test.js`: add cases for the `modelError` path (404 body with
  `not_found_error` → `modelError`; a 404 with an unrelated/unparseable body
  → still `offline`, to prove the fallback isn't greedy). Existing tests
  (which call `classifyResponse` without a `body` arg) keep passing
  unchanged.

### Docs

- `README.md`: add `claudeStats.model` to the settings table; brief note in
  "How it gets the data" that the polling model is configurable and an
  invalid id surfaces as a status-bar warning.

## Error handling

Covered above — the only new error path is `modelError`, and it's additive:
every other classification (`noauth`, `expired`, `offline`, `ok`) is
unchanged.

## Testing

Unit tests in `test/api.test.js` cover the new classification branch, both
positive (model error detected) and negative (unrelated 400/404 still falls
to offline). Existing test suite must continue to pass unmodified.
