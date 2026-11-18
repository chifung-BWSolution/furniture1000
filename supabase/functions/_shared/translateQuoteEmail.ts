import type { QuoteEmailFooterText } from "./quoteEmailFooter.ts";
type QuoteEmailLocale = keyof QuoteEmailFooterText;

const googleLanguage: Record<QuoteEmailLocale, string> = {
  "zh-Hant": "zh-TW",
  "zh-Hans": "zh-CN",
  en: "en",
};

// Batches follow the same Cloud Translation Basic API as QMS.
// Blank fields stay in place so the caller can map the result back to the draft.
export async function translateQuoteEmail(
  values: unknown,
  locale: unknown,
  key: string,
  request: typeof fetch = fetch,
): Promise<string[]> {
  if (locale !== "zh-Hant" && locale !== "zh-Hans" && locale !== "en") {
    throw new Error("無效的翻譯語言");
  }
  if (!Array.isArray(values) || values.length > 21 ||
      values.some((value) => typeof value !== "string" || value.length > 2000)) {
    throw new Error("翻譯內容超出郵件模板限制");
  }
  const entries = values.map((value, index) => ({ value, index })).filter(({ value }) => value.trim());
  if (!entries.length) return values;
  if (!key) throw new Error("此環境尚未設定 Google Cloud 翻譯");

  const response = await request("https://translation.googleapis.com/language/translate/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ q: entries.map(({ value }) => value), target: googleLanguage[locale], format: "text" }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(response.status === 429 ? "Google Cloud 翻譯暫時達到用量上限" : "Google Cloud 翻譯未能完成");
  }
  const payload = await response.json();
  const translations = payload?.data?.translations;
  if (!Array.isArray(translations) || translations.length !== entries.length ||
      translations.some((entry) => typeof entry?.translatedText !== "string" || !entry.translatedText.trim())) {
    throw new Error("Google Cloud 回傳的翻譯不完整");
  }

  const result = [...values];
  entries.forEach(({ index }, position) => {
    result[index] = translations[position].translatedText;
  });
  return result;
}
