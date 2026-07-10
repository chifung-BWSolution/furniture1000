/**
 * Publish workflow timestamps — Hong Kong wall clock as ISO-8601 with +08:00.
 * Stored in Postgres `timestamptz` (same pattern as info_completed_at writes).
 */
export function getPublishTimestampHk(date = new Date()): string {
  const hk = date.toLocaleString('sv-SE', { timeZone: 'Asia/Hong_Kong' });
  return `${hk.replace(' ', 'T')}+08:00`;
}

/** HK calendar date YYYY-MM-DD for daily upload_log rollups. */
export function getPublishDateHk(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(date);
}
