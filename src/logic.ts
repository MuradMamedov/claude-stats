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
