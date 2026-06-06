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
