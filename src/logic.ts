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

export function formatClock(resetEpochSec: number, includeDate = false): string {
  const d = new Date(resetEpochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  if (!includeDate) {
    return time;
  }
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${time} ${month} ${d.getDate()}`;
}

export type ColorId = 'charts.green' | 'charts.yellow' | 'charts.red';

export function pickColorId(
  utilPct: number,
  status: string,
  greenBelow: number,
  yellowBelow: number
): ColorId {
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

export function buildTooltip(info: RateInfo, nowMs: number): string {
  const p5 = Math.round(info.fiveHourUtil * 100);
  const p7 = Math.round(info.sevenDayUtil * 100);
  return [
    `5h: ${p5}% — resets ${formatClock(info.fiveHourReset)} (${formatCountdown(info.fiveHourReset, nowMs)})`,
    `7d: ${p7}% — resets ${formatClock(info.sevenDayReset, true)}`,
    `status: ${info.fiveHourStatus}`
  ].join('\n\n');
}
