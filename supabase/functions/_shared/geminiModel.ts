/** Default Gemini model for every Edge function. Keep in sync with src/lib/geminiModel.ts. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Model to call, read at request time:
 * 1. Edge secret GEMINI_MODEL, when set, wins (switch models without a redeploy).
 * 2. Otherwise the caller's requested model, unless it is a retired 1.x / 2.x id
 *    (old clients and persisted settings still send gemini-2.5-flash).
 * 3. Otherwise DEFAULT_GEMINI_MODEL.
 */
export function resolveGeminiModel(requested?: unknown): string {
  const env = (Deno.env.get("GEMINI_MODEL") ?? "").trim();
  if (env) return env;
  const req = typeof requested === "string" ? requested.trim() : "";
  if (req && !/^gemini-[12](\.|-)/.test(req)) return req;
  return DEFAULT_GEMINI_MODEL;
}

/** Gemini 3.x model ids (gemini-3-…, gemini-3.8-flash, …). */
export function isGemini3Model(model: string): boolean {
  return /^gemini-3(\.|-)/.test(model.trim());
}

/**
 * generationConfig fields that keep thinking low on Gemini 3.x, spread into
 * generationConfig. Default thinking on gemini-3.8-flash is "medium", which made
 * large extraction calls outlive the ~150s Edge gateway limit. gemini-3.8-flash
 * accepts low | medium | high ("minimal" is rejected). "low" by default;
 * set Edge secret GEMINI_THINKING_LEVEL=medium|high to override without a redeploy.
 * Other models get nothing, so their request bodies are unchanged.
 */
export type GeminiThinkingLevel = "low" | "medium" | "high";

/** Edge secret GEMINI_THINKING_LEVEL (low | medium | high), default "low". Anything else falls back to "low". */
export function geminiThinkingLevel(): GeminiThinkingLevel {
  const v = (Deno.env.get("GEMINI_THINKING_LEVEL") ?? "").trim().toLowerCase();
  return v === "medium" || v === "high" ? v : "low";
}

export function geminiThinkingConfig(model: string): { thinkingConfig?: { thinkingLevel: GeminiThinkingLevel } } {
  return isGemini3Model(model) ? { thinkingConfig: { thinkingLevel: geminiThinkingLevel() } } : {};
}
