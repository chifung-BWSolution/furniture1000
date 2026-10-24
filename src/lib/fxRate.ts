/**
 * 今日匯率抓取（CNY¥ → HKD$）。
 *
 * 專案內（PMS／FDS）沒有既有匯率接口，這裡直接呼叫免費公開 API，best-effort：
 * - open.er-api.com（每日更新、免金鑰、支援 CORS）
 * - frankfurter.dev（歐洲央行參考價、免金鑰、支援 CORS）作為後備
 * 全部失敗回 null，呼叫方保持原狀（placeholder），不阻塞彈窗。
 */
const ER_API_URL = "https://open.er-api.com/v6/latest/CNY";
const FRANKFURTER_API_URL = "https://api.frankfurter.dev/v1/latest?base=CNY&symbols=HKD";

function toPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

/** 抓取當日 CNY→HKD 匯率；失敗回 null（不拋錯）。 */
export async function fetchTodayCnyHkdRate(): Promise<number | null> {
  try {
    const data = await fetchJson(ER_API_URL);
    const rate = toPositiveNumber((data as { rates?: { HKD?: unknown } } | null)?.rates?.HKD);
    if (rate) return rate;
  } catch {
    // fall through to backup source
  }
  try {
    const data = await fetchJson(FRANKFURTER_API_URL);
    const rate = toPositiveNumber((data as { rates?: { HKD?: unknown } } | null)?.rates?.HKD);
    if (rate) return rate;
  } catch {
    // ignore — caller falls back to manual input
  }
  return null;
}

/** 匯率顯示：最多 2 位小數，去掉尾隨零（0.92130 → "0.92"）。 */
export function formatFxRate(rate: number): string {
  return String(Math.round(rate * 100) / 100);
}
