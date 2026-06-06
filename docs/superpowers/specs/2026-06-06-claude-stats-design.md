# claude-stats — Design Spec

**Date:** 2026-06-06
**Status:** Approved

## Summary

A VS Code extension that shows the user's official Claude **5-hour plan
utilization** in the status bar, color-coded by how close they are to the
limit, with a countdown to the next reset. Clicking the item opens the Claude
usage settings page in the browser.

The extension repurposes the existing `status-bar-demo` scaffold in this repo.

## Goal

Give Claude Code / Claude.ai subscribers an at-a-glance, always-visible readout
of their current plan usage without opening the browser, using the **official**
limit numbers (not local estimates).

## Data source

Plan utilization comes from the Anthropic API's unified rate-limit **response
headers**, the same numbers shown on claude.ai/settings/usage. These are
returned on any authenticated Messages API call:

| Header | Meaning |
|---|---|
| `anthropic-ratelimit-unified-5h-utilization` | 5-hour window usage, fraction 0..1 |
| `anthropic-ratelimit-unified-5h-reset` | 5-hour window reset, Unix epoch seconds |
| `anthropic-ratelimit-unified-5h-status` | `allowed` / `allowed_warning` / `rejected` |
| `anthropic-ratelimit-unified-7d-utilization` | weekly usage fraction |
| `anthropic-ratelimit-unified-7d-reset` | weekly reset, Unix epoch seconds |
| `anthropic-ratelimit-unified-7d-status` | weekly status |

The API returns **no absolute token count**, only the utilization fraction.
Therefore the extension displays percentages only — no "used tokens" number,
and no local transcript parsing.

### Authentication

The OAuth access token lives in `~/.claude/.credentials.json`:

```
claudeAiOauth.accessToken    (string)
claudeAiOauth.refreshToken   (string)
claudeAiOauth.expiresAt      (number)
claudeAiOauth.subscriptionType
claudeAiOauth.rateLimitTier
```

The extension **re-reads this file before each poll** and uses
`claudeAiOauth.accessToken`. It does **not** implement the OAuth refresh flow —
Claude Code refreshes the token and rewrites the file, so the extension
piggybacks on that. If the token is expired and Claude Code has not refreshed
it, the API returns 401 and the extension shows an error state (below).

The poll request:

```
POST https://api.anthropic.com/v1/messages
headers:
  content-type: application/json
  authorization: Bearer <accessToken>
  anthropic-version: 2023-06-01
  anthropic-beta: oauth-2025-04-20
body: {"model":"claude-haiku-4-5-20251001","max_tokens":1,
       "messages":[{"role":"user","content":"hi"}]}
```

The response body is discarded; only the rate-limit headers are read.

## Architecture

Single-file extension (`src/extension.ts`), no transcript parsing, no extra
runtime dependencies (Node's built-in `https` + `fs`).

Flow:

1. **activate()** — create status bar item, register commands, start poll timer,
   subscribe to window focus changes, do an initial poll.
2. **poll()** — read credentials file → make the minimal Messages request →
   parse the unified-5h/7d headers → update render state. On any failure, set
   the appropriate error state.
3. **render()** — set status bar `text`, `color`, `tooltip` from current state.
4. **dispose()** — clear timer, dispose item (via `context.subscriptions`).

## Status bar item

- **Alignment:** Right.
- **Text:** `$(pulse) <5h%>% · <countdown>` — e.g. `$(pulse) 38% · 2h14m`.
  - `<5h%>` = `round(unified-5h-utilization * 100)`.
  - `<countdown>` = `unified-5h-reset` epoch minus now, formatted `Xh YYm` (or
    `YYm` under an hour).
- **Color** (text color via `vscode.ThemeColor`, thresholds configurable):
  - util% < `greenBelow` (default 70) → green
  - `greenBelow` ≤ util% < `yellowBelow` (default 90) → yellow
  - util% ≥ `yellowBelow` → red
  - Override: if `unified-5h-status == "rejected"` → red regardless of %.
- **Tooltip** (markdown string):
  - `5h: 38% — resets 16:30 (2h14m)`
  - `7d: 23% — resets Mon 09:00`
  - `status: allowed`
  - `updated 30s ago`
- **Command:** `claudeStats.openUsage`.

## Commands

| Command id | Title | Action |
|---|---|---|
| `claudeStats.openUsage` | Claude Stats: Open Usage Page | `vscode.env.openExternal("https://claude.ai/new#settings/usage")` |
| `claudeStats.refresh` | Claude Stats: Refresh | force an immediate poll |

## Polling

- Interval: `claudeStats.pollIntervalMinutes` (default **5**).
- When `claudeStats.pauseWhenUnfocused` (default **true**) and the VS Code
  window is not focused, skip scheduled polls. Resume + poll once on regaining
  focus. This avoids the monitor consuming the user's own quota while idle.
- Always poll on activation and on `claudeStats.refresh`.
- Cost disclosure: each poll is ~8 input / 1 output Haiku tokens. Negligible,
  but it does count toward the user's own 5-hour window; documented in README.

## Error / edge states

| Condition | Status bar | Tooltip |
|---|---|---|
| `.credentials.json` missing or no `accessToken` | `$(warning) Claude —` | "Not logged in — no Claude credentials found." |
| HTTP 401 | `$(warning) Claude —` | "Token expired — run Claude Code to refresh." |
| Network error / non-2xx (not 401) | last good value, dimmed | "Offline · stale (last <n>%)." |
| Before first successful poll | `$(sync~spin) Claude …` | "Loading…" |

Error states are red/`warning` colored where shown.

## Configuration (`contributes.configuration`)

| Key | Type | Default | Notes |
|---|---|---|---|
| `claudeStats.pollIntervalMinutes` | number | 5 | minimum enforced at 1 |
| `claudeStats.pauseWhenUnfocused` | boolean | true | |
| `claudeStats.greenBelow` | number | 70 | util% below this is green |
| `claudeStats.yellowBelow` | number | 90 | util% below this is yellow; at/above is red |

## Manifest changes

- Rename package `status-bar-demo` → `claude-stats`; update `displayName`,
  `description`.
- Replace the `statusBarDemo.showWordCount` command with `claudeStats.openUsage`
  and `claudeStats.refresh`.
- Add `contributes.configuration`.
- Keep `activationEvents: ["onStartupFinished"]`.

## Out of scope (YAGNI)

- Absolute token-count display.
- Weekly (7d) window in the status bar text (tooltip only).
- Usage history / charts.
- Multi-account.
- Implementing the OAuth refresh flow (delegated to Claude Code).
- Local transcript (`~/.claude/projects/*.jsonl`) parsing.

## Manual test plan

| Action | Expected |
|---|---|
| Launch Extension Dev Host with valid creds | `$(pulse) N% · Xh YYm`, colored by N |
| Hover the item | tooltip shows 5h + 7d + status + updated |
| Click the item | browser opens claude.ai usage page |
| Run `Claude Stats: Refresh` | item updates immediately |
| Rename/remove `.credentials.json` | `$(warning) Claude —`, "not logged in" tooltip |
| Set util high (≥90 threshold) | item turns red |
| Unfocus VS Code with pause on | no further polls until refocus |
