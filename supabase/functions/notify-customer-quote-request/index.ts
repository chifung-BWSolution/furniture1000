import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { escapeHtml, isSafeEmail, sendEmail } from "../_shared/email.ts";

/**
 * FDS-14：客戶提交報價選擇後通知該單負責 PM。
 *
 * 流程：claim（RPC，跳過已被其他 worker 鎖定的列）→ 發信 → mark。
 * - 沒有 PM 電郵時記錄 pm_email_missing，不猜地址。
 * - 失敗保留錯誤與 attempts，5 次後停止；下次呼叫只會再處理未過期的列。
 * - 同一筆記錄只會發一次成功信（mark 後 pm_notified_at 有值）。
 *
 * 呼叫方式：
 *   POST { "limit": 10 }
 * 授權：x-worker-secret（pg_cron／vault）或 admin／uploader／pm 登入帳號。
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CALLER_ROLES = ["admin", "uploader", "pm"];

type ClaimedRequest = {
  id: string;
  quote_uuid: string;
  quote_id: string;
  request_type: string;
  lines: Array<{ name?: string; quantity?: number; selected?: boolean; unit?: string; note?: string }>;
  note: string;
  total_cents: number;
  submitted_at: string;
  pm_name: string | null;
  pm_email: string | null;
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

function money(cents: number): string {
  return `HK$ ${(Math.max(0, Number(cents) || 0) / 100).toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function selectedLines(request: ClaimedRequest) {
  return (request.lines ?? []).filter((line) => line.selected && Number(line.quantity) > 0);
}

function buildMessage(request: ClaimedRequest): { subject: string; text: string; html: string } {
  const appUrl = (Deno.env.get("FDS_APP_URL") ?? "").trim().replace(/\/+$/, "");
  const quoteLink = appUrl ? `${appUrl}/quote/${encodeURIComponent(request.quote_id)}` : "";
  const rows = selectedLines(request);
  const subject = `客戶提交報價選擇：${request.quote_id || "未命名報價"}`;
  const linesText = rows.length
    ? rows.map((line) => `- ${line.name || "未命名項目"} × ${line.quantity}${line.unit ? ` ${line.unit}` : ""}${line.note ? `（${line.note}）` : ""}`).join("\n")
    : "- 客戶沒有勾選項目，只留下需求說明。";
  const text = [
    `${request.quote_id || "報價"} 收到客戶提交。`,
    "",
    linesText,
    "",
    `客戶選品合計（只作參考，不是正式報價金額）：${money(request.total_cents)}`,
    request.note ? `客戶需求：${request.note}` : "",
    request.pm_name ? `負責同事：${request.pm_name}` : "",
    quoteLink ? `開啟報價：${quoteLink}` : "",
    "",
    "客戶提交不會改寫正式報價的單價、明細或總額；請確認後另行處理正式報價。",
  ].filter((row) => row !== "").join("\n");

  const rowsHtml = rows.length
    ? rows.map((line) => `<li>${escapeHtml(line.name || "未命名項目")} × ${escapeHtml(String(line.quantity ?? ""))}${line.unit ? ` ${escapeHtml(line.unit)}` : ""}${line.note ? `（${escapeHtml(line.note)}）` : ""}</li>`).join("")
    : "<li>客戶沒有勾選項目，只留下需求說明。</li>";
  const html = `<div style="font-family:system-ui,-apple-system,'Noto Sans HK',sans-serif;font-size:14px;line-height:1.6;color:#1a1a2e;">
  <p>${escapeHtml(request.quote_id || "報價")} 收到客戶提交。</p>
  <ul>${rowsHtml}</ul>
  <p>客戶選品合計（只作參考，不是正式報價金額）：<strong>${escapeHtml(money(request.total_cents))}</strong></p>
  ${request.note ? `<p>客戶需求：${escapeHtml(request.note)}</p>` : ""}
  ${request.pm_name ? `<p>負責同事：${escapeHtml(request.pm_name)}</p>` : ""}
  ${quoteLink ? `<p><a href="${escapeHtml(quoteLink)}">開啟報價</a></p>` : ""}
  <p style="color:#555">客戶提交不會改寫正式報價的單價、明細或總額；請確認後另行處理正式報價。</p>
</div>`;
  return { subject, text, html };
}

async function recordEmailLog(
  admin: SupabaseClient,
  request: ClaimedRequest,
  recipient: string,
  status: "success" | "failed",
  detail: { provider?: string | null; messageId?: string | null; error?: string | null },
) {
  const { error } = await admin.from("email_notification_logs").insert({
    recipient,
    notification_type: "quote_customer_request",
    related_quote_id: request.quote_id || null,
    status,
    error_message: detail.error ?? null,
    provider: detail.provider ?? null,
    message_id: detail.messageId ?? null,
    payload: {
      customer_request_id: request.id,
      quote_uuid: request.quote_uuid,
      line_count: selectedLines(request).length,
      total_cents: request.total_cents,
    },
  });
  if (error) console.error("[notify-customer-quote-request] log insert", error.message);
}

type ClaimedView = {
  id: string;
  quote_uuid: string;
  quote_id: string;
  viewed_at: string;
};

async function pmRecipient(admin: SupabaseClient, quoteUuid: string): Promise<{ quoteId: string; pmName: string; email: string }> {
  const { data: quote } = await admin
    .from("bwf_quote")
    .select("quote_id, project_data, submitter")
    .eq("id", quoteUuid)
    .maybeSingle();
  const formData = (quote?.project_data as { formData?: { projectManager?: string } } | null)?.formData;
  const pmName = String(formData?.projectManager ?? quote?.submitter ?? "").trim();
  let email = "";
  if (pmName) {
    const { data: profiles } = await admin
      .from("platform_user_profiles")
      .select("email, role")
      .eq("active", true)
      .in("role", ["pm", "admin", "uploader"])
      .ilike("display_name", pmName)
      .limit(5);
    const rows = (profiles ?? []) as Array<{ email?: string | null; role?: string | null }>;
    email = String((rows.find((row) => row.role === "pm") ?? rows[0])?.email ?? "");
  }
  return { quoteId: String(quote?.quote_id ?? ""), pmName, email };
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

  const { data: claimed, error: claimError } = await admin.rpc("fds_quote_request_claim_notifications", { p_limit: limit });
  if (claimError) return json({ error: claimError.message }, 500);

  const requests = (claimed ?? []) as ClaimedRequest[];
  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const request of requests) {
    const email = String(request.pm_email ?? "").trim();
    if (!email || !isSafeEmail(email)) {
      await admin.rpc("fds_quote_request_mark_notified", { p_id: request.id, p_error: "pm_email_missing" });
      results.push({ id: request.id, status: "pm_email_missing" });
      continue;
    }
    try {
      const message = buildMessage(request);
      const sent = await sendEmail({ to: [email], ...message });
      await recordEmailLog(admin, request, email, "success", {
        provider: sent.provider,
        messageId: sent.id,
      });
      await admin.rpc("fds_quote_request_mark_notified", { p_id: request.id, p_error: null });
      results.push({ id: request.id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      await recordEmailLog(admin, request, email, "failed", { error: message });
      await admin.rpc("fds_quote_request_mark_notified", { p_id: request.id, p_error: message });
      results.push({ id: request.id, status: "failed", error: message });
    }
  }

  // FDS-14：客戶由電郵連結成功載入授權頁 → 通知同一張報價的 PM（每個有效查看只發一次）。
  const viewResults: Array<{ id: string; status: string; error?: string }> = [];
  const { data: views, error: viewClaimError } = await admin.rpc("fds_quote_view_claim_notifications", { p_limit: limit });
  if (!viewClaimError) {
    for (const view of ((views ?? []) as ClaimedView[])) {
      try {
        const { quoteId, pmName, email } = await pmRecipient(admin, view.quote_uuid);
        if (!isSafeEmail(email)) {
          await admin.rpc("fds_quote_view_mark_notified", { p_id: view.id, p_error: "pm_email_missing" });
          viewResults.push({ id: view.id, status: "pm_email_missing" });
          continue;
        }
        const viewedAt = new Date(view.viewed_at).toISOString().slice(0, 16).replace("T", " ");
        const subject = `客戶已查看報價：${quoteId || "未命名報價"}`;
        const text = `${quoteId || "報價"} 的客戶已於 ${viewedAt} 開啟授權頁。\n\n這只會停止該單的自動跟進信，其他報價不受影響。`;
        const html = `<div style="font-family:system-ui,-apple-system,'Noto Sans HK',sans-serif;font-size:14px;line-height:1.7;color:#1a1a2e;">
  <p>${escapeHtml(quoteId || "報價")} 的客戶已於 ${escapeHtml(viewedAt)} 開啟授權頁。</p>
  <p style="color:#555">這只會停止該單的自動跟進信，其他報價不受影響。</p>
</div>`;
        const sent = await sendEmail({ to: [email], subject, text, html });
        const { error: logError } = await admin.from("email_notification_logs").insert({
          recipient: email,
          notification_type: "quote_view",
          related_quote_id: quoteId || null,
          status: "success",
          provider: sent.provider,
          message_id: sent.id,
          payload: { quote_uuid: view.quote_uuid, share_view_id: view.id, pm_name: pmName },
        });
        if (logError) console.error("[notify-customer-quote-request] view log", logError.message);
        await admin.rpc("fds_quote_view_mark_notified", { p_id: view.id, p_error: null });
        viewResults.push({ id: view.id, status: "sent" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "send failed";
        await admin.rpc("fds_quote_view_mark_notified", { p_id: view.id, p_error: message });
        viewResults.push({ id: view.id, status: "failed", error: message });
      }
    }
  }

  return json({ ok: true, claimed: requests.length, results, views: viewResults });
});
