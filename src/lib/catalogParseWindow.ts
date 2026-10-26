/** Catalog parsing window: 23:00–09:00 Asia/Shanghai. 09:00 is outside the window. */
export const CATALOG_PARSE_TIME_ZONE = 'Asia/Shanghai';

export function shanghaiHour(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CATALOG_PARSE_TIME_ZONE,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('Unable to read Asia/Shanghai hour');
  }
  return hour;
}

/** True from 23:00 inclusive until 09:00 exclusive. */
export function isCatalogParseWindow(now: Date = new Date()): boolean {
  const hour = shanghaiHour(now);
  return hour >= 23 || hour < 9;
}
