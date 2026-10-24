import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

/**
 * AI 用量記錄：寫入 public.ai_usage_logs（RLS 只給 admin/uploader 讀，寫入靠 service_role）。
 * 全部 best-effort —— 記錄失敗不可以影響主要請求，只 console.warn。
 */

let cachedClient: SupabaseClient | null = null;

function usageClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
  }
  return cachedClient;
}

export type AiUsageEntry = {
  /** 來源 edge function，例如 "gemini-proxy"、"gemini-pdf-catalog" */
  source: string;
  /** 呼叫端功能標籤（前端帶入），例如 "publish_copywriting" */
  feature?: string | null;
  model?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  promptTokens?: unknown;
  outputTokens?: unknown;
  totalTokens?: unknown;
  meta?: Record<string, unknown>;
};

function safeCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}

export async function logAiUsage(entry: AiUsageEntry): Promise<void> {
  try {
    if (!entry.source) return;
    const { error } = await usageClient().from("ai_usage_logs").insert({
      source: entry.source.slice(0, 80),
      feature: entry.feature ? String(entry.feature).slice(0, 80) : null,
      model: entry.model ? String(entry.model).slice(0, 120) : null,
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ? String(entry.userEmail).slice(0, 200) : null,
      prompt_tokens: safeCount(entry.promptTokens),
      output_tokens: safeCount(entry.outputTokens),
      total_tokens: safeCount(entry.totalTokens),
      meta: entry.meta ?? {},
    });
    if (error) console.warn("[ai-usage] insert failed:", error.message);
  } catch (error) {
    console.warn("[ai-usage] log error:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * 從 Authorization header 解出使用者（只解 JWT payload 做「歸因」，不做授權判斷）。
 * anon key / service key 的 payload.role 不是 "authenticated"，會回匿名。
 */
export function decodeJwtUser(req: Request): { userId: string | null; userEmail: string | null } {
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const parts = jwt.split(".");
    if (parts.length !== 3) return { userId: null, userEmail: null };
    const json = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (json?.role && json.role !== "authenticated") return { userId: null, userEmail: null };
    return {
      userId: typeof json?.sub === "string" ? json.sub : null,
      userEmail: typeof json?.email === "string" ? json.email : null,
    };
  } catch {
    return { userId: null, userEmail: null };
  }
}
