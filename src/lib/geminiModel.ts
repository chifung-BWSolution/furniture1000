/**
 * Default Gemini model requested by the browser. Edge functions resolve the final model
 * (Edge secret GEMINI_MODEL overrides; retired 1.x/2.x ids fall back to the default).
 * Keep in sync with supabase/functions/_shared/geminiModel.ts.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
