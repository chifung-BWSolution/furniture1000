import { geminiThinkingConfig, resolveGeminiModel } from "./geminiModel.ts";
import {
  buildDefaultProductHighlights,
  deriveDefaultProductTitle,
  formatQuoteItemDimensions,
  isQuoteServiceFeeItem,
  normalizeQuoteEmailLocale,
  stripHtmlToSpecText,
  type QuoteEmailLocale,
  type QuoteEmailPreviewItem,
} from "./quoteCustomerEmail.ts";

export interface DraftQuoteEmailInput {
  items: QuoteEmailPreviewItem[];
  sampleItems?: string | null;
  clientName?: string | null;
  clientIndustry?: string[] | null;
  locale?: string;
}

export interface DraftQuoteEmailResult {
  productTitle: string;
  productHighlights: string;
  source: "ai" | "fallback";
}

function readSecret(name: string): string {
  return (typeof Deno === "undefined" ? "" : Deno.env.get(name) ?? "").trim();
}

function parseDraftJson(raw: string): { productTitle: string; productHighlights: string } | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const productTitle = String(record.productTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const productHighlights = String(record.productHighlights ?? "").trim().slice(0, 4000);
  if (!productTitle || !productHighlights) return null;
  return { productTitle, productHighlights };
}

function languageGuide(locale: QuoteEmailLocale): string {
  if (locale === "zh-Hans") {
    return "Output Simplified Chinese (zh-Hans) matching Hong Kong commercial furniture terminology.";
  }
  if (locale === "en") {
    return "Output natural, concise British/Hong Kong business English.";
  }
  return "Output Traditional Chinese (zh-Hant, Hong Kong commercial style, e.g. 學生枱凳, 註塑, 尺寸).";
}

function buildDraftPrompt(
  items: QuoteEmailPreviewItem[],
  clientName: string,
  locale: QuoteEmailLocale,
): string {
  const compactItems = items.slice(0, 20).map((item) => ({
    name: item.name,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    dimensions: formatQuoteItemDimensions(item) || null,
    material: stripHtmlToSpecText(item.material, locale) || null,
    color: item.color && !/^(?:按圖|按图|as shown)$/i.test(item.color.trim()) ? item.color.trim() : null,
    remarks: item.remarks?.trim() || null,
  }));

  return [
    "You are drafting two short fields for a BW Furniture quotation email.",
    languageGuide(locale),
    "Return ONLY valid JSON with keys \"productTitle\" and \"productHighlights\".",
    "Rules:",
    "1. productTitle: concise 2-12 character (or 2-5 word in English) phrase summarizing the main furniture items for the email subject (e.g. '學生枱凳', '辦公桌椅', 'Student Desks & Chairs'). Do NOT include the word '報價單'/'Quotation', client name, or delivery/dismantling fees.",
    "2. productHighlights: a numbered plain-text list ('1. ...\\n2. ...') describing each main furniture item (skip pure delivery/installation/disposal fee rows unless there are no furniture rows). Preserve every exact quantity, unit, W x D x H mm dimensions, and material/feature facts from the input; polish fragmented bullet points into smooth, natural sentences like:",
    "   1. 學生枱（140 張）：尺寸 W620 x D450 x H750 mm。設有 750 / 720 / 690 mm 三檔高度調節，立柱採用 1.2 毫米厚優質冷軋鋼管，穩固耐用；檯面採用 ABS 註塑工藝，防刮耐磨且易於清潔。",
    "3. Never invent dimensions, materials, quantities, or prices that are not in the input. No markdown bold/bullets inside JSON strings.",
    clientName ? `Client: ${clientName}` : "",
    `Items JSON:\n${JSON.stringify(compactItems)}`,
  ].filter(Boolean).join("\n");
}

async function askGemini(
  apiKey: string,
  prompt: string,
  request: typeof fetch,
): Promise<{ productTitle: string; productHighlights: string } | null> {
  const model = resolveGeminiModel();
  const response = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          ...geminiThinkingConfig(model),
        },
      }),
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw new Error(`Gemini ${response.status}`);
  const payload = await response.json();
  const parts = payload?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((part: { text?: string }) => part?.text ?? "").join("")
    : "";
  return parseDraftJson(text);
}

async function askXai(
  apiKey: string,
  prompt: string,
  request: typeof fetch,
): Promise<{ productTitle: string; productHighlights: string } | null> {
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
  return typeof text === "string" ? parseDraftJson(text) : null;
}

export async function draftQuoteEmailWithAi(
  input: DraftQuoteEmailInput,
  request: typeof fetch = fetch,
): Promise<DraftQuoteEmailResult> {
  const locale = normalizeQuoteEmailLocale(input.locale);
  const rawItems = Array.isArray(input.items) ? input.items.filter((item) => item?.name?.trim()) : [];
  const furniture = rawItems.filter((item) => !isQuoteServiceFeeItem(item));
  const targetItems = furniture.length ? furniture : rawItems;

  const fallback: DraftQuoteEmailResult = {
    productTitle: deriveDefaultProductTitle(targetItems, locale),
    productHighlights: buildDefaultProductHighlights(targetItems, input.sampleItems, locale),
    source: "fallback",
  };

  if (!targetItems.length) return fallback;

  const prompt = buildDraftPrompt(targetItems, String(input.clientName ?? "").trim(), locale);
  const geminiKey = readSecret("GEMINI_API_KEY");
  if (geminiKey) {
    try {
      const parsed = await askGemini(geminiKey, prompt, request);
      if (parsed) return { ...parsed, source: "ai" };
    } catch (error) {
      console.warn("[draft-quote-email] gemini", error instanceof Error ? error.message : error);
    }
  }

  const xaiKey = readSecret("XAI_API_KEY");
  if (xaiKey) {
    try {
      const parsed = await askXai(xaiKey, prompt, request);
      if (parsed) return { ...parsed, source: "ai" };
    } catch (error) {
      console.warn("[draft-quote-email] xai", error instanceof Error ? error.message : error);
    }
  }

  return fallback;
}
