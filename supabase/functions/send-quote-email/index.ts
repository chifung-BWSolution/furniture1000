import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml, isSafeEmail, sendEmail } from "../_shared/email.ts";

/**
 * FDS-15 郵件 worker。
 *
 * 每次呼叫：
 *   1. 按 next_follow_up_at 排入到期跟進信（每單每 3 天一次，去重）
 *   2. claim 待發郵件（status = sending，attempts + 1）
 *   3. 用「發送當下」的模板組成固定三段 + 自訂段，交給共用發信服務
 *   4. 成功 → mark sent（手動首封會開自動跟進，3 天後再寄）；
 *      失敗 → 交回 queue 重試，3 次後 failed，錯誤保留。
 *
 * 授權：x-worker-secret（pg_cron／vault）或 admin／uploader／pm 登入帳號。
 * 注意：`_shared/email.ts` 屬 shared module，必須用 supabase CLI 部署，單檔上傳不會打包。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CALLER_ROLES = ["admin", "uploader", "pm"];

type ClaimedEmail = {
  id: string;
  quote_uuid: string;
  kind: "manual" | "follow_up";
  to_email: string;
  attempts: number;
  quote_id: string;
  intro_text: string;
  contact_phone: string;
  custom_sections: Array<{ title?: string; body?: string }>;
  settings_status: string;
  share_token: string | null;
  item_count: number;
  total_amount: number;
  sample_items: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return json({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return json({ error: "Unauthorized" }, 401);
    return null;
  }
  const jwt = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!jwt || !url || !anonKey) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) return json({ error: "Unauthorized" }, 401);
  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", { p_roles: CALLER_ROLES });
  if (roleError || allowed !== true) return json({ error: "permission_denied" }, 403);
  return null;
}

function money(dollars: number): string {
  return `HK$ ${(Math.max(0, Number(dollars) || 0)).toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function appUrl(): string {
  return (Deno.env.get("FDS_APP_URL") ?? "").trim().replace(/\/+$/, "");
}

function shareUrl(token: string | null): string {
  const base = appUrl();
  if (!base || !token) return "";
  return `${base}/customer?quote_share=${encodeURIComponent(token)}`;
}

function plainCustomSections(row: ClaimedEmail): Array<{ title: string; body: string }> {
  if (!Array.isArray(row.custom_sections)) return [];
  return row.custom_sections.flatMap((section) => {
    const title = String(section?.title ?? "").trim().slice(0, 60);
    const body = String(section?.body ?? "").trim().slice(0, 800);
    if (!title && !body) return [];
    return [{ title, body }];
  });
}

function buildMessage(row: ClaimedEmail): { subject: string; text: string; html: string } {
  const count = Math.max(0, Number(row.item_count) || 0);
  const link = shareUrl(row.share_token);
  const intro = String(row.intro_text ?? "").trim();
  const summary = [
    count > 0 ? `共 ${count} 項傢俬。` : "報價內容請見加單授權連結。",
    row.sample_items ? `包括：${row.sample_items}。` : "",
    Number(row.total_amount) > 0 ? `參考總額 ${money(Number(row.total_amount))}。` : "",
    intro,
  ].filter(Boolean).join(" ");

  const isFollowUp = row.kind === "follow_up";
  const subject = isFollowUp
    ? `跟進：${row.quote_id || "傢俬方案"}（可隨時加單或改數量）`
    : `${row.quote_id || "傢俬方案"} 報價及加單連結`;

  const custom = plainCustomSections(row);
  const textBlocks = [
    summary,
    `如對方案有任何問題，可致電 ${row.contact_phone} 與負責同事聯絡。`,
    link ? `需要加單、改數量或替換款式，請用這個連結提交：${link}` : "",
    ...custom.map((section) => [section.title, section.body].filter(Boolean).join("\n")),
    "此為系統發出的參考報價通知，正式報價以雙方確認的版本為準。",
  ].filter(Boolean);

  const htmlBlocks = [
    `<p>${escapeHtml(summary)}</p>`,
    `<p>如對方案有任何問題，可致電 <strong>${escapeHtml(row.contact_phone)}</strong> 與負責同事聯絡。</p>`,
    link ? `<p>需要加單、改數量或替換款式，請用<a href="${escapeHtml(link)}">這個連結</a>提交。</p>` : "",
    ...custom.map((section) => `<section><h3 style="font-size:14px;margin:16px 0 4px;">${escapeHtml(section.title)}</h3><p style="white-space:pre-wrap;margin:0;">${escapeHtml(section.body)}</p></section>`),
    `<p style="color:#666;font-size:12px;">此為系統發出的參考報價通知，正式報價以雙方確認的版本為準。</p>`,
  ].filter(Boolean);

  return {
    subject,
    text: textBlocks.join("\n\n"),
    html: `<div style="font-family:system-ui,-apple-system,'Noto Sans HK',sans-serif;font-size:14px;line-height:1.7;color:#1a1a2e;">${htmlBlocks.join("")}</div>`,
  };
}

async function recordLog(
  admin: SupabaseClient,
  row: ClaimedEmail,
  status: "success" | "failed",
  detail: { provider?: string | null; messageId?: string | null; error?: string | null },
) {
  const { error } = await admin.from("email_notification_logs").insert({
    recipient: row.to_email,
    notification_type: row.kind === "follow_up" ? "quote_email_follow_up" : "quote_email_manual",
    related_quote_id: row.quote_id || null,
    status,
    error_message: detail.error ?? null,
    provider: detail.provider ?? null,
    message_id: detail.messageId ?? null,
    payload: { quote_uuid: row.quote_uuid, message_id: row.id, attempts: row.attempts },
  });
  if (error) console.error("[send-quote-email] log insert", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let admin: SupabaseClient;
  try {
    admin = adminClient();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Server misconfigured" }, 500);
  }

  const denied = await authorize(req, admin);
  if (denied) return denied;

  let limit = 10;
  try {
    const body = await req.json();
    if (body && Number.isFinite(Number(body.limit))) limit = Number(body.limit);
  } catch {
    // empty body is fine
  }

  const { data: queuedFollowUps, error: enqueueError } = await admin.rpc("fds_quote_email_enqueue_follow_ups", {
    p_limit: limit,
  });
  if (enqueueError) return json({ error: enqueueError.message }, 500);

  const { data: claimed, error: claimError } = await admin.rpc("fds_quote_email_claim", { p_limit: limit });
  if (claimError) return json({ error: claimError.message }, 500);

  const rows = (Array.isArray(claimed) ? claimed : []) as ClaimedEmail[];
  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const row of rows) {
    const to = String(row.to_email ?? "").trim();
    if (!isSafeEmail(to)) {
      await admin.rpc("fds_quote_email_mark", { p_id: row.id, p_status: "failed", p_error: "invalid_recipient" });
      results.push({ id: row.id, status: "invalid_recipient" });
      continue;
    }
    if (!row.contact_phone || !row.contact_phone.trim()) {
      await admin.rpc("fds_quote_email_mark", { p_id: row.id, p_status: "failed", p_error: "contact_phone_missing" });
      results.push({ id: row.id, status: "contact_phone_missing" });
      continue;
    }
    if (!row.share_token) {
      await admin.rpc("fds_quote_email_mark", { p_id: row.id, p_status: "failed", p_error: "share_link_missing" });
      results.push({ id: row.id, status: "share_link_missing" });
      continue;
    }

    try {
      // Race guard: the customer may have viewed (or the PM stopped follow-ups)
      // between claim and send. confirm_send re-checks and cancels the message.
      const { data: canSend, error: confirmError } = await admin.rpc("fds_quote_email_confirm_send", { p_id: row.id });
      if (confirmError) throw new Error(confirmError.message);
      if (canSend !== true) {
        results.push({ id: row.id, status: "cancelled_before_send" });
        continue;
      }
      const message = buildMessage(row);
      const sent = await sendEmail({ to: [to], ...message });
      await recordLog(admin, row, "success", { provider: sent.provider, messageId: sent.id });
      await admin.rpc("fds_quote_email_mark", {
        p_id: row.id,
        p_status: "sent",
        p_error: null,
        p_provider: sent.provider,
        p_message_id: sent.id,
      });
      results.push({ id: row.id, status: "sent" });
    } catch (error) {
      const text = error instanceof Error ? error.message : "send failed";
      const retryable = row.attempts < 3;
      await recordLog(admin, row, "failed", { error: text });
      await admin.rpc("fds_quote_email_mark", {
        p_id: row.id,
        p_status: retryable ? "queued" : "failed",
        p_error: text,
      });
      results.push({ id: row.id, status: retryable ? "queued_for_retry" : "failed", error: text });
    }
  }

  return json({ ok: true, follow_ups_enqueued: Number(queuedFollowUps) || 0, claimed: rows.length, results });
});
