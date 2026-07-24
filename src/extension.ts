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
let timer: ReturnType<typeof setTimeout> | undefined;
let tick: ReturnType<typeof setInterval> | undefined;
let lastInfo: RateInfo | undefined;
let inFlight: Promise<void> | undefined;

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
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeStats')) {
        renderOk();
        scheduleNext();
      }
    })
  );

  renderLoading();
  item.show();
  void poll();
  scheduleNext();

  // Re-render on a short cadence so the tooltip's reset countdown advances
  // between polls instead of freezing at render time.
  tick = setInterval(() => {
    if (lastInfo) {
      renderOk();
    }
  }, 10_000);
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

function poll(): Promise<void> {
  // Collapse overlapping triggers (timer, focus, manual refresh) into one
  // in-flight request so each cycle bills at most one API call.
  if (!inFlight) {
    inFlight = doPoll().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

async function doPoll(): Promise<void> {
  const cfg = config();
  if (cfg.pauseWhenUnfocused && !vscode.window.state.focused && lastInfo) {
    return;
  }
  const result = await fetchRateInfo(defaultCredentialsPath());
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
    default: {
      const _exhaustive: never = result.kind;
      throw new Error(`unhandled fetch error: ${String(_exhaustive)}`);
    }
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
  item.tooltip = buildTooltip(lastInfo, now);
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
  if (tick) {
    clearInterval(tick);
  }
}
