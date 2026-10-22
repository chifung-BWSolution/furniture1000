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
