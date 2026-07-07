/** Value shown in the 匯率 input — keeps trailing "." while typing (e.g. "1."). */
export function exchangeRateInputDisplay(
  input: string | undefined,
  rate: number | null | undefined,
): string {
  if (input !== undefined) return input;
  if (rate == null) return "";
  return String(rate);
}

/** Sanitize exchange-rate text input: digits and one decimal point, max 3 decimal places. */
export function sanitizeExchangeRateInput(raw: string): string {
  let s = raw.replace(/[^\d.]/g, "");
  const dotIdx = s.indexOf(".");
  if (dotIdx !== -1) {
    s = s.slice(0, dotIdx + 1) + s.slice(dotIdx + 1).replace(/\./g, "");
    const [whole, frac = ""] = s.split(".");
    if (frac.length > 3) {
      s = `${whole}.${frac.slice(0, 3)}`;
    }
  }
  return s;
}

/** Parse sanitized exchange-rate text to a number (3 dp) or null when empty/invalid. */
export function parseExchangeRateValue(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === ".") return null;
  const n = parseFloat(trimmed);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 1000) / 1000;
}

/** CNY cost × exchange rate, stored with max 3 decimal places. */
export function computeHkdCostPrice(
  costPrice: number | null | undefined,
  exchangeRate: number | null | undefined,
): number | null {
  if (costPrice == null || exchangeRate == null) return null;
  if (costPrice <= 0 || exchangeRate <= 0) return null;
  return Math.round(costPrice * exchangeRate * 1000) / 1000;
}

/** UI display: ceil to integer (1234.0 → 1234, 1234.1 → 1235). */
export function formatHkdCostDisplayCeil(
  hkdCostPrice: number | null | undefined,
): string {
  if (hkdCostPrice == null) return "—";
  return String(Math.ceil(hkdCostPrice));
}
