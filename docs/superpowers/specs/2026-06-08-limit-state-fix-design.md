# claude-stats — 429 Limit-State Fix — Design Spec

**Date:** 2026-06-08
**Status:** Approved

## Problem

When the user exhausts their 5-hour limit, the Anthropic Messages API rejects
the poll request with **HTTP 429**. In `src/api.ts`, any non-2xx status other
than 401 is bucketed as `{ ok: false, kind: 'offline' }`. The extension then:

- shows the **last good value** dimmed with a `$(cloud-offline)` icon
  ("stuck on the last value"), or
- shows the **"Offline"** error state if there was no prior successful poll.

Either way the user cannot see that they are actually rate-limited, nor when the
window resets.

## Key fact

A 429 response from the unified rate-limit system **still carries the same
rate-limit headers** as a 2xx response:

| Header | On a 429 |
|---|---|
| `anthropic-ratelimit-unified-5h-utilization` | ≈ `1.0` |
| `anthropic-ratelimit-unified-5h-status` | `rejected` |
| `anthropic-ratelimit-unified-5h-reset` | epoch seconds of reset |
| (7d headers) | present as usual |

So the data needed to render the real maxed-out state is already in the 429.

## Approach (chosen)

**Treat 429 as a success for parsing purposes.** Parse the unified headers from
the 429 exactly as for a 2xx response and return `{ ok: true, info }`. The
existing render path already does the right thing with that data — no new result
kind, no new render branch.

Rejected alternatives:

- **New `limited` result kind + dedicated render.** More code; the user did not
  want a distinct "Limit" label, so it buys nothing.
- **Parse headers on any response that has them.** More robust against odd
  statuses (e.g. a 400 still has headers) but adds logic and risks masking real
  errors. Not needed for this fix.

## Change

### `src/api.ts` — only file changed

In the `res.on('end', …)` handler, add a 429 branch before the generic else.
200–299 and 429 share one parse branch:

```
status === 401            → { ok: false, kind: 'expired' }
status 200–299 OR === 429 → { ok: true, info: parseRateHeaders(res.headers) }
else                      → { ok: false, kind: 'offline' }
```

5xx, 529 (overloaded), and network/timeout errors are unchanged — they remain
`offline` and keep the existing stale-value behaviour, which is correct for a
transient outage.

### Rendering — no change

`src/extension.ts`:

- `renderOk()` → `pickColorId()` already returns `charts.red` when
  `fiveHourStatus === 'rejected'`, regardless of threshold config.
- `buildBarText()` already renders `$(pulse) 100% · <countdown>` from
  `fiveHourUtil` and `fiveHourReset`.
- `buildTooltip()` already shows `status: rejected`.

The countdown ticks down to the reset time on each render. The next scheduled
poll after the window resets returns a normal 2xx and the bar recovers
automatically.

### `src/logic.ts` — no change

`parseRateHeaders`, `pickColorId`, `buildBarText`, `buildTooltip` already handle
the rejected/100% case.

## Out of scope (YAGNI)

- Headerless-429 guard. A 429 is assumed to carry the unified headers; if it
  somehow does not, `parseRateHeaders` defaults util to 0 — accepted small risk.
- Distinct "Limit reached" label or icon. The user chose the standard
  `100% · resets Xh` layout in red.
- Any change to 5xx / 529 / network handling.

## Tests — `test/api.test.js`

Add:

- **429 with rate-limit headers** → result is `{ ok: true }`; `info` has
  `fiveHourStatus === 'rejected'`, `fiveHourUtil ≈ 1.0`, and the parsed
  `fiveHourReset`.

Keep / confirm:

- 2xx with headers → `{ ok: true }` (unchanged).
- 401 → `{ ok: false, kind: 'expired' }` (unchanged).
- 500 (or other non-2xx, non-429) → `{ ok: false, kind: 'offline' }`
  (unchanged — guards against the 429 branch being too greedy).

## Manual test plan

| Action | Expected |
|---|---|
| Poll while 5h limit is exhausted (429) | `$(pulse) 100% · <countdown>` in red; tooltip `status: rejected` |
| Wait past the 5h reset, next poll | bar returns to normal color/percent automatically |
| Kill network (simulate offline) | unchanged: last value dimmed `$(cloud-offline)`, or "Offline" if no prior |
