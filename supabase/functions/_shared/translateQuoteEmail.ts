import { geminiThinkingConfig, resolveGeminiModel } from "./geminiModel.ts";
import type { QuoteEmailLocale } from "./quoteCustomerEmail.ts";

const googleLanguage: Record<QuoteEmailLocale, string> = {
  "zh-Hant": "zh-TW",
  "zh-Hans": "zh-CN",
  en: "en",
};

const languageName: Record<QuoteEmailLocale, string> = {
  "zh-Hant": "Traditional Chinese",
  "zh-Hans": "Simplified Chinese",
  en: "English",
};

// Google Cloud Translation is used when its key is set. This project does not
// have that key, so furniture-name translation falls back to Gemini, then xAI.
const FALLBACK_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function readSecret(name: string): string {
  return (typeof Deno === "undefined" ? "" : Deno.env.get(name) ?? "").trim();
}

function parseTranslationArray(text: string, expected: number): string[] | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) return null;
  if (parsed.some((value) => typeof value !== "string" || !value.trim())) return null;
  return parsed.map((value) => value.trim());
}

function translationPrompt(values: string[], locale: QuoteEmailLocale): string {
  return [
    `Translate each furniture name into ${languageName[locale]} for a quotation.`,
    "Keep existing English product names, dimensions and model codes.",
    "Return only a JSON array of strings, same length and order, with no explanation.",
    JSON.stringify(values),
  ].join("\n");
}

async function translateWithModel(
  values: string[],
  locale: QuoteEmailLocale,
  request: typeof fetch,
): Promise<string[]> {
  const prompt = translationPrompt(values, locale);
  const geminiKey = readSecret("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      const translated = await askGemini(geminiKey, prompt, values.length, request);
      if (translated) return translated;
    } catch (error) {
      console.warn("[translate-quote-email] gemini", error instanceof Error ? error.message : error);
    }
  }
  const xaiKey = readSecret("XAI_API_KEY");
  if (xaiKey) return askXai(xaiKey, prompt, values.length, request);
  throw new Error("此環境尚未設定翻譯服務");
}

async function askGemini(
  apiKey: string,
  prompt: string,
  expected: number,
  request: typeof fetch,
): Promise<string[] | null> {
  const model = resolveGeminiModel();
  const response = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          ...geminiThinkingConfig(model),
        },
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}`);
  }
  const payload = await response.json();
  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part: { text?: string }) => part?.text ?? "").join("")
    : "";
  return parseTranslationArray(text, expected);
}

async function askXai(
  apiKey: string,
  prompt: string,
  expected: number,
  request: typeof fetch,
): Promise<string[]> {
  const model = readSecret("XAI_CHAT_MODEL") || "grok-4.7";
  const response = await request("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning_effort: "low",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`xAI ${response.status}`);
  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content;
  const translated = typeof text === "string" ? parseTranslationArray(text, expected) : null;
  if (!translated) throw new Error("翻譯回傳不完整");
  return translated;
}

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
  const source = entries.map(({ value }) => value);

  let translated: string[] | null = null;
  if (key) {
    const response = await request("https://translation.googleapis.com/language/translate/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
      body: JSON.stringify({ q: source, target: googleLanguage[locale], format: "text" }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.ok) {
      const payload = await response.json();
      const translations = payload?.data?.translations;
      if (Array.isArray(translations) && translations.length === entries.length &&
          translations.every((entry) => typeof entry?.translatedText === "string" && entry.translatedText.trim())) {
        translated = translations.map((entry) => entry.translatedText);
      }
    } else if (!FALLBACK_STATUSES.has(response.status)) {
      throw new Error("Google Cloud 翻譯未能完成");
    }
  }
  if (!translated) translated = await translateWithModel(source, locale, request);

  const result = [...values];
  entries.forEach(({ index }, position) => {
    result[index] = translated[position];
  });
  return result;
}
