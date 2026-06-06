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

export function formatClock(resetEpochSec: number): string {
  const d = new Date(resetEpochSec * 1000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
