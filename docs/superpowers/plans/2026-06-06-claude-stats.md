# claude-stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code status bar item showing official Claude 5-hour plan utilization (color-coded, with reset countdown) that opens the usage page on click.

**Architecture:** All pure logic (rate-limit header parsing, color selection, countdown/clock formatting, bar text, tooltip) lives in a vscode-free `src/logic.ts`, unit-tested with Node's built-in `node:test` against the compiled `out/logic.js`. Network + filesystem access live in `src/api.ts`. The vscode glue (status bar, poll timer, focus handling, commands) lives in `src/extension.ts` and is verified manually in the Extension Development Host.

**Tech Stack:** TypeScript, VS Code Extension API (`vscode`), Node built-ins (`https`, `fs`, `node:test`). No new runtime dependencies.

---

## File Structure

- `src/logic.ts` — **create.** Pure functions, no `vscode`/`https`/`fs` imports. Header parsing, color id, countdown/clock formatting, bar text, tooltip.
- `src/api.ts` — **create.** `readCredentials()` (fs) and `fetchRateInfo()` (https). Returns plain data; no `vscode`.
- `src/extension.ts` — **modify (replace contents).** vscode glue: status bar item, poll timer, focus pause, commands, orchestration.
- `test/logic.test.js` — **create.** `node:test` unit tests, `require('../out/logic.js')`.
- `test/api.test.js` — **create.** `node:test` unit tests for `readCredentials` using a temp fixture file.
- `package.json` — **modify.** Rename, commands, configuration, `test` script.
- `README.md` — **modify (replace contents).** New purpose, run/test/cost docs.

Pure logic is split from glue so the testable surface needs no VS Code host. `logic.ts` must never import `vscode`, `https`, or `fs`, or the unit tests can't load it.

---

## Task 1: Rename manifest, add commands + configuration

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rewrite `package.json`**

Replace the whole file with:

```json
{
  "name": "claude-stats",
  "displayName": "Claude Stats",
  "description": "Shows your Claude 5-hour plan usage in the status bar.",
  "version": "0.0.1",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "claudeStats.openUsage",
        "title": "Claude Stats: Open Usage Page"
      },
      {
        "command": "claudeStats.refresh",
        "title": "Claude Stats: Refresh"
      }
    ],
    "configuration": {
      "title": "Claude Stats",
      "properties": {
        "claudeStats.pollIntervalMinutes": {
          "type": "number",
          "default": 5,
          "minimum": 1,
          "description": "How often to refresh usage, in minutes."
        },
        "claudeStats.pauseWhenUnfocused": {
          "type": "boolean",
          "default": true,
          "description": "Skip scheduled refreshes while the VS Code window is not focused."
        },
        "claudeStats.greenBelow": {
          "type": "number",
          "default": 70,
          "description": "5-hour utilization percent below which the item is green."
        },
        "claudeStats.yellowBelow": {
          "type": "number",
          "default": 90,
          "description": "5-hour utilization percent below which the item is yellow; at or above it is red."
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "npm run compile && node --test test/"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "@types/vscode": "^1.85.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run compile`
Expected: exits 0 (the existing `src/extension.ts` still references the old command but still compiles; it is replaced in Task 6).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: rename to claude-stats, add commands and configuration"
```

---

## Task 2: `parseRateHeaders` (logic)

**Files:**
- Create: `src/logic.ts`
- Test: `test/logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/logic.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../out/logic.js'` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/logic.ts`:

```typescript
export interface RateInfo {
  fiveHourUtil: number;
  fiveHourReset: number;
  fiveHourStatus: string;
  sevenDayUtil: number;
  sevenDayReset: number;
  sevenDayStatus: string;
}

type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function parseRateHeaders(headers: HeaderBag): RateInfo {
  const num = (name: string): number => {
    const v = header(headers, name);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const str = (name: string): string => header(headers, name) ?? 'unknown';
  return {
    fiveHourUtil: num('anthropic-ratelimit-unified-5h-utilization'),
    fiveHourReset: num('anthropic-ratelimit-unified-5h-reset'),
    fiveHourStatus: str('anthropic-ratelimit-unified-5h-status'),
    sevenDayUtil: num('anthropic-ratelimit-unified-7d-utilization'),
    sevenDayReset: num('anthropic-ratelimit-unified-7d-reset'),
    sevenDayStatus: str('anthropic-ratelimit-unified-7d-status')
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (both `parseRateHeaders` tests).

- [ ] **Step 5: Commit**

```bash
git add src/logic.ts test/logic.test.js
git commit -m "feat: parse unified rate-limit headers"
```

---

## Task 3: `formatCountdown` and `formatClock` (logic)

**Files:**
- Modify: `src/logic.ts`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/logic.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `formatCountdown is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/logic.ts`:

```typescript
export function formatCountdown(resetEpochSec: number, nowMs: number): string {
  const diffMs = resetEpochSec * 1000 - nowMs;
  if (diffMs <= 0) {
    return 'now';
  }
  const totalMin = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) {
    return `${hours}h${String(mins).padStart(2, '0')}m`;
  }
  return `${mins}m`;
}

export function formatClock(resetEpochSec: number): string {
  const d = new Date(resetEpochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all logic tests so far).

- [ ] **Step 5: Commit**

```bash
git add src/logic.ts test/logic.test.js
git commit -m "feat: add countdown and clock formatting"
```

---

## Task 4: `pickColorId`, `buildBarText`, `buildTooltip` (logic)

**Files:**
- Modify: `src/logic.ts`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/logic.test.js`:

```javascript
const { pickColorId, buildBarText, buildTooltip } = require('../out/logic.js');

test('pickColorId uses thresholds', () => {
  assert.strictEqual(pickColorId(50, 'allowed', 70, 90), 'charts.green');
  assert.strictEqual(pickColorId(75, 'allowed', 70, 90), 'charts.yellow');
  assert.strictEqual(pickColorId(95, 'allowed', 70, 90), 'charts.red');
});

test('pickColorId forces red when rejected', () => {
  assert.strictEqual(pickColorId(10, 'rejected', 70, 90), 'charts.red');
});

test('buildBarText shows rounded percent and countdown', () => {
  const now = 1_000_000_000_000;
  const info = {
    fiveHourUtil: 0.384,
    fiveHourReset: Math.floor(now / 1000) + 2 * 3600 + 14 * 60,
    fiveHourStatus: 'allowed',
    sevenDayUtil: 0.23,
    sevenDayReset: Math.floor(now / 1000) + 3600,
    sevenDayStatus: 'allowed'
  };
  assert.strictEqual(buildBarText(info, now), '$(pulse) 38% · 2h14m');
});

test('buildTooltip includes both windows and status', () => {
  const now = 1_000_000_000_000;
  const info = {
    fiveHourUtil: 0.38,
    fiveHourReset: Math.floor(now / 1000) + 2 * 3600 + 14 * 60,
    fiveHourStatus: 'allowed',
    sevenDayUtil: 0.23,
    sevenDayReset: Math.floor(now / 1000) + 24 * 3600,
    sevenDayStatus: 'allowed'
  };
  const tip = buildTooltip(info, now, now - 30000);
  assert.match(tip, /5h: 38%/);
  assert.match(tip, /7d: 23%/);
  assert.match(tip, /status: allowed/);
  assert.match(tip, /updated 30s ago/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `pickColorId is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/logic.ts`:

```typescript
export function pickColorId(
  utilPct: number,
  status: string,
  greenBelow: number,
  yellowBelow: number
): string {
  if (status === 'rejected') {
    return 'charts.red';
  }
  if (utilPct < greenBelow) {
    return 'charts.green';
  }
  if (utilPct < yellowBelow) {
    return 'charts.yellow';
  }
  return 'charts.red';
}

export function buildBarText(info: RateInfo, nowMs: number): string {
  const pct = Math.round(info.fiveHourUtil * 100);
  return `$(pulse) ${pct}% · ${formatCountdown(info.fiveHourReset, nowMs)}`;
}

export function buildTooltip(
  info: RateInfo,
  nowMs: number,
  lastUpdatedMs: number
): string {
  const p5 = Math.round(info.fiveHourUtil * 100);
  const p7 = Math.round(info.sevenDayUtil * 100);
  const agoSec = Math.max(0, Math.round((nowMs - lastUpdatedMs) / 1000));
  return [
    `5h: ${p5}% — resets ${formatClock(info.fiveHourReset)} (${formatCountdown(info.fiveHourReset, nowMs)})`,
    `7d: ${p7}% — resets ${formatClock(info.sevenDayReset)}`,
    `status: ${info.fiveHourStatus}`,
    `updated ${agoSec}s ago`
  ].join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (all logic tests).

- [ ] **Step 5: Commit**

```bash
git add src/logic.ts test/logic.test.js
git commit -m "feat: add color selection, bar text, and tooltip builders"
```

---

## Task 5: `readCredentials` and `fetchRateInfo` (api)

**Files:**
- Create: `src/api.ts`
- Test: `test/api.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/api.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../out/api.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/api.ts`:

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import { parseRateHeaders, RateInfo } from './logic';

export interface OauthCreds {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export function defaultCredentialsPath(): string {
  return path.join(os.homedir(), '.claude', '.credentials.json');
}

export function readCredentials(filePath: string): OauthCreds | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed?.claudeAiOauth ?? null;
  } catch {
    return null;
  }
}

export type FetchResult =
  | { ok: true; info: RateInfo }
  | { ok: false; kind: 'noauth' | 'expired' | 'offline' };

export function fetchRateInfo(credentialsPath: string): Promise<FetchResult> {
  return new Promise((resolve) => {
    const creds = readCredentials(credentialsPath);
    if (!creds?.accessToken) {
      resolve({ ok: false, kind: 'noauth' });
      return;
    }
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
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
        // Drain the body; we only need the headers.
        res.on('data', () => undefined);
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
      }
    );
    req.on('error', () => resolve({ ok: false, kind: 'offline' }));
    req.write(body);
    req.end();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS (`readCredentials` tests; `fetchRateInfo` is exercised manually in Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/api.ts test/api.test.js
git commit -m "feat: add credentials reader and rate-info fetcher"
```

---

## Task 6: Extension glue (`extension.ts`)

**Files:**
- Modify (replace contents): `src/extension.ts`

No unit test — this is vscode glue, verified manually in the Extension Development Host (see Manual Verification below).

- [ ] **Step 1: Replace `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import {
  buildBarText,
  buildTooltip,
  pickColorId,
  RateInfo
} from './logic';
import { defaultCredentialsPath, fetchRateInfo } from './api';

const USAGE_URL = 'https://claude.ai/new#settings/usage';

let item: vscode.StatusBarItem;
let timer: NodeJS.Timeout | undefined;
let lastInfo: RateInfo | undefined;
let lastUpdatedMs = 0;

export function activate(context: vscode.ExtensionContext): void {
  item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  item.command = 'claudeStats.openUsage';
  context.subscriptions.push(item);

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeStats.openUsage', () => {
      vscode.env.openExternal(vscode.Uri.parse(USAGE_URL));
    }),
    vscode.commands.registerCommand('claudeStats.refresh', () => {
      void poll();
    }),
    vscode.window.onDidChangeWindowState((s) => {
      if (s.focused) {
        void poll();
      }
    })
  );

  renderLoading();
  item.show();
  void poll();
  scheduleNext();
}

function config() {
  const c = vscode.workspace.getConfiguration('claudeStats');
  return {
    pollIntervalMinutes: c.get<number>('pollIntervalMinutes', 5),
    pauseWhenUnfocused: c.get<boolean>('pauseWhenUnfocused', true),
    greenBelow: c.get<number>('greenBelow', 70),
    yellowBelow: c.get<number>('yellowBelow', 90)
  };
}

function scheduleNext(): void {
  if (timer) {
    clearTimeout(timer);
  }
  const minutes = Math.max(1, config().pollIntervalMinutes);
  timer = setTimeout(() => {
    void poll().finally(scheduleNext);
  }, minutes * 60_000);
}

async function poll(): Promise<void> {
  const cfg = config();
  if (cfg.pauseWhenUnfocused && !vscode.window.state.focused && lastInfo) {
    return;
  }
  const result = await fetchRateInfo(defaultCredentialsPath());
  if (result.ok) {
    lastInfo = result.info;
    lastUpdatedMs = Date.now();
    renderOk();
  } else if (result.kind === 'noauth') {
    renderError('$(warning) Claude —', 'Not logged in — no Claude credentials found.');
  } else if (result.kind === 'expired') {
    renderError('$(warning) Claude —', 'Token expired — run Claude Code to refresh.');
  } else {
    renderOffline();
  }
}

function renderLoading(): void {
  item.text = '$(sync~spin) Claude …';
  item.tooltip = 'Loading…';
  item.color = undefined;
}

function renderOk(): void {
  if (!lastInfo) {
    return;
  }
  const cfg = config();
  const now = Date.now();
  const pct = Math.round(lastInfo.fiveHourUtil * 100);
  item.text = buildBarText(lastInfo, now);
  item.tooltip = buildTooltip(lastInfo, now, lastUpdatedMs);
  item.color = new vscode.ThemeColor(
    pickColorId(pct, lastInfo.fiveHourStatus, cfg.greenBelow, cfg.yellowBelow)
  );
}

function renderError(text: string, tooltip: string): void {
  item.text = text;
  item.tooltip = tooltip;
  item.color = new vscode.ThemeColor('charts.red');
}

function renderOffline(): void {
  if (lastInfo) {
    const pct = Math.round(lastInfo.fiveHourUtil * 100);
    item.text = `$(cloud-offline) ${pct}%`;
    item.tooltip = `Offline · stale (last ${pct}%).`;
    item.color = undefined;
  } else {
    renderError('$(warning) Claude —', 'Offline — could not reach the API.');
  }
}

export function deactivate(): void {
  if (timer) {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Compile**

Run: `npm run compile`
Expected: exits 0, no type errors.

- [ ] **Step 3: Manual verification in Extension Development Host**

1. Open this folder in VS Code, press **F5**.
2. In the `[Extension Development Host]` window, confirm the status bar shows
   `$(pulse) N% · Xh YYm` colored per N (green/yellow/red).
3. Hover: tooltip shows `5h:`, `7d:`, `status:`, `updated …s ago`.
4. Click the item: browser opens `https://claude.ai/new#settings/usage`.
5. Run **Claude Stats: Refresh** from the palette: item updates.
6. Temporarily rename `~/.claude/.credentials.json`; run **Claude Stats: Refresh**:
   item shows `$(warning) Claude —` with "Not logged in" tooltip. Restore the file.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire status bar item, polling, focus pause, and commands"
```

---

## Task 7: README

**Files:**
- Modify (replace contents): `README.md`

- [ ] **Step 1: Replace `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for claude-stats"
```

---

## Self-Review notes

- **Spec coverage:** data source/auth (Tasks 2,5), % + countdown bar (Tasks 3,4,6),
  color thresholds + rejected override (Task 4,6), tooltip with 5h/7d/status/updated
  (Task 4,6), click opens usage URL (Task 6), polling + pause-when-unfocused (Task 6),
  config keys (Task 1), all four error states — noauth/expired/offline/loading
  (Tasks 5,6), manifest rename (Task 1), README cost + refresh disclosure (Task 7).
  All spec sections map to a task.
- **No transcript parsing / no OAuth refresh / no token count / no 7d-in-bar** — matches
  spec "Out of scope".
- **Type consistency:** `RateInfo` fields (`fiveHourUtil/Reset/Status`, `sevenDay…`) are
  used identically across `logic.ts`, `api.ts`, and `extension.ts`. `pickColorId`,
  `buildBarText`, `buildTooltip`, `parseRateHeaders`, `readCredentials`, `fetchRateInfo`,
  `FetchResult` (`kind: 'noauth'|'expired'|'offline'`) names match across tasks.
```
