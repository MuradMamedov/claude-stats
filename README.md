# Claude Stats

A VS Code status bar item showing your **Claude 5-hour plan usage** (official
numbers, color-coded), with a countdown to the next reset. Click it to open the
Claude usage settings page.

## What it does

- Shows `$(pulse) N% · Xh YYm` in the status bar — N = 5-hour window
  utilization, countdown = time until that window resets.
- Color: green below 70%, yellow below 90%, red at/above 90% (or red whenever
  the API reports the window as `rejected`). Thresholds are configurable.
- Tooltip shows the 5-hour and weekly (7-day) percentages, reset times, status,
  and when it last updated.
- Clicking opens `https://claude.ai/new#settings/usage`.

## How it gets the data

Usage comes from the Anthropic API's `anthropic-ratelimit-unified-*` response
headers — the same numbers shown on the Claude usage page. The extension reads
the OAuth token from `~/.claude/.credentials.json` (written by Claude Code) and
makes a minimal request to read those headers.

**Cost note:** each refresh is one tiny request (Haiku, 1 output token —
negligible), but it does count toward your own 5-hour window. Refreshes happen
every 5 minutes by default and pause while the VS Code window is unfocused.

**Token refresh:** the extension does not implement OAuth refresh — it re-reads
`~/.claude/.credentials.json` each poll, so it uses whatever token Claude Code
last wrote. If the token expires and Claude Code has not refreshed it, the item
shows "Token expired — run Claude Code to refresh."

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeStats.pollIntervalMinutes` | 5 | Refresh interval in minutes. |
| `claudeStats.pauseWhenUnfocused` | true | Skip refreshes while VS Code is unfocused. |
| `claudeStats.greenBelow` | 70 | Percent below which the item is green. |
| `claudeStats.yellowBelow` | 90 | Percent below which the item is yellow. |

## Develop

```bash
npm install
npm run compile   # or: npm run watch
npm test          # runs unit tests for the pure logic
```

Press **F5** to launch an Extension Development Host with the extension loaded.

## Project layout

```
package.json        manifest: commands + configuration
src/logic.ts        pure logic (header parse, color, formatting) — unit tested
src/api.ts          credentials read + API fetch
src/extension.ts    vscode glue: status bar, polling, commands
test/*.test.js      node:test unit tests against out/
```
