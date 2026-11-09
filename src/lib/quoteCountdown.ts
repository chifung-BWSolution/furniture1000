/**
 * 報價一覽倒數：每張報價由建立日期起計 45 日。
 * 超過 45 日仍未成功，該報價視為不成功（不再顯示負數天數）。
 */
export const QUOTE_COUNTDOWN_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 剩餘日數（無條件進位）。建立當日為 45 天，第 45 日完結後回傳 0 或負數。
 * 日期缺失或無效時回傳 null。
 */
export function quoteRemainingDays(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!createdAt) return null;
  const start = new Date(createdAt);
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return null;
  const deadline = startMs + QUOTE_COUNTDOWN_DAYS * DAY_MS;
  return Math.ceil((deadline - now.getTime()) / DAY_MS);
}

/** 已過 45 日倒數期限；日期缺失時不當作不成功。 */
export function isQuoteUnsuccessful(remainingDays: number | null): boolean {
  return remainingDays !== null && remainingDays <= 0;
}
