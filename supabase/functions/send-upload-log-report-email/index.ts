import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchUploadLogReportServer } from "./uploadLogReportServer.ts";
import { formatTodayUploadLogReportAsHtml, formatUploadLogReportAsHtml } from "./uploadLogReportHtml.ts";
import { formatTodayUploadLogReportAsText, formatUploadLogReportAsText } from "./uploadLogReportText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Inbox used when the request omits `to`. Env wins; the Gmail address is the historical default. */
const DEFAULT_TO = Deno.env.get("UPLOAD_LOG_REPORT_TO_EMAIL")?.trim() || "brandingworks.ebiz@gmail.com";
const CALLER_ROLES = ["admin", "uploader", "pm"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isSafeEmail(value: string): boolean {
  if (!value || value.length > 320) return false;
  if (/[\r\n\0]/.test(value)) return false;
  return /^[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+$/.test(value);
}

function normalizeRecipients(to: string | string[] | undefined, fallback: string): string[] {
  const raw = to == null || to === "" ? [fallback] : Array.isArray(to) ? to : [to];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const trimmed = String(entry ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.length > 0 ? out : [fallback];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildForwardNotice(forwardTo: string): { text: string; html: string; subjectSuffix: string } {
  const trimmed = forwardTo.trim();
  const safeText = trimmed.replace(/[\r\n]/g, " ");
  const safeHtml = escapeHtml(safeText);
  return {
    subjectSuffix: `（請轉寄 ${safeText}）`,
    text: `【請轉寄】此郵件請轉寄至：${safeText}\n\n`,
    html: `<p style="margin:0 0 16px;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:13px;color:#9a3412;line-height:1.5;"><strong>請轉寄：</strong>此郵件請轉寄至 <a href="mailto:${encodeURIComponent(safeText)}" style="color:#c2410c;">${safeHtml}</a></p>`,
  };
}

function furnitureAdmin(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signed-in admin / uploader / pm, or the vault worker secret used by pg_cron. */
async function authorizeCaller(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return jsonResponse({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", { p_secret: secret });
    if (error || data !== true) return jsonResponse({ error: "Unauthorized" }, 401);
    return null;
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.match(/^Bearer\s+(\S+)$/i)?.[1]?.trim() ?? "";
  if (!jwt) return jsonResponse({ error: "Unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    return jsonResponse({ error: "SUPABASE_ANON_KEY is not configured" }, 500);
  }
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user?.id) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", {
    p_roles: CALLER_ROLES,
  });
  if (roleError || allowed !== true) return jsonResponse({ error: "permission_denied" }, 403);
  return null;
}

/** UPLOAD_LOG_REPORT_TO_EMAIL (or its historical default) plus active profile emails. */
async function loadAllowedRecipients(admin: SupabaseClient): Promise<Set<string>> {
  const allowed = new Set<string>();
  if (isSafeEmail(DEFAULT_TO)) allowed.add(DEFAULT_TO.toLowerCase());

  const { data, error } = await admin
    .from("platform_user_profiles")
    .select("email")
    .eq("active", true);
  if (error) throw new Error(`recipient lookup failed: ${error.message}`);
  for (const row of data ?? []) {
    const email = String((row as { email?: string }).email ?? "").trim();
    if (isSafeEmail(email)) allowed.add(email.toLowerCase());
  }
  return allowed;
}

function recipientsAllowed(addresses: string[], allowed: Set<string>): boolean {
  return addresses.every((address) => isSafeEmail(address) && allowed.has(address.toLowerCase()));
}

async function sendEmailViaGmailSmtp(args: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ id: string }> {
  const user = Deno.env.get("GMAIL_SMTP_USER") ?? Deno.env.get("SMTP_USER") ?? "";
  const pass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? Deno.env.get("SMTP_PASS") ?? "";
  if (!user || !pass) {
    throw new Error("Gmail SMTP not configured");
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });

  const readResponse = async (): Promise<string> => {
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    return n === null ? "" : decoder.decode(buf.subarray(0, n));
  };
  const sendLine = async (line: string): Promise<string> => {
    await conn.write(encoder.encode(`${line}\r\n`));
    return readResponse();
  };
  const toBase64 = (value: string) => btoa(unescape(encodeURIComponent(value)));

  await readResponse();
  await sendLine("EHLO furniture-platform");
  await sendLine("AUTH LOGIN");
  await sendLine(toBase64(user));
  const authResp = await sendLine(toBase64(pass));
  if (!authResp.startsWith("235")) {
    conn.close();
    throw new Error(`SMTP auth failed: ${authResp.trim()}`);
  }

  await sendLine(`MAIL FROM:<${user}>`);
  for (const recipient of args.to) {
    const rcptResp = await sendLine(`RCPT TO:<${recipient}>`);
    if (!rcptResp.startsWith("250")) {
      conn.close();
      throw new Error(`SMTP RCPT failed for ${recipient}: ${rcptResp.trim()}`);
    }
  }
  await sendLine("DATA");
  const boundary = `----=_Part_${Date.now()}`;
  const body = [
    `From: FDS Furniture <${user}>`,
    `To: ${args.to.join(", ")}`,
    `Subject: =?UTF-8?B?${toBase64(args.subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(args.text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(args.html),
    "",
    `--${boundary}--`,
    ".",
  ].join("\r\n");
  const dataResp = await sendLine(body);
  await sendLine("QUIT");
  conn.close();
  if (!dataResp.startsWith("250")) {
    throw new Error(`SMTP DATA failed: ${dataResp.trim()}`);
  }
  return { id: `smtp-${Date.now()}` };
}

async function sendReportEmail(args: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ id?: string; provider: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (resendKey) {
    try {
      const result = await sendEmailViaResend(args);
      return { id: result.id, provider: "resend" };
    } catch (resendErr) {
      const gmailUser = Deno.env.get("GMAIL_SMTP_USER") ?? Deno.env.get("SMTP_USER") ?? "";
      const gmailPass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? Deno.env.get("SMTP_PASS") ?? "";
      if (!gmailUser || !gmailPass) throw resendErr;
      console.warn("[send-upload-log-report-email] Resend failed, falling back to Gmail SMTP");
    }
  }

  try {
    const result = await sendEmailViaGmailSmtp(args);
    return { id: result.id, provider: "gmail_smtp" };
  } catch (gmailErr) {
    throw new Error(
      `Email not configured. Set RESEND_API_KEY or GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD in Edge Function secrets. (${
        gmailErr instanceof Error ? gmailErr.message : "smtp failed"
      })`,
    );
  }
}

async function sendEmailViaResend(args: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ id?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const from = Deno.env.get("UPLOAD_LOG_REPORT_FROM_EMAIL") ??
    "FDS Furniture <onboarding@resend.dev>";

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured in Edge Function secrets");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Resend API failed (${res.status}): ${
        typeof payload === "object" && payload && "message" in payload
          ? String((payload as { message?: string }).message)
          : JSON.stringify(payload)
      }`,
    );
  }
  return payload as { id?: string };
}

async function recordEmailLogs(args: {
  recipients: string[];
  status: "success" | "failed";
  errorMessage?: string | null;
  provider?: string | null;
  messageId?: string | null;
  payload: Record<string, unknown>;
  resendOf?: string | null;
}): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key || args.recipients.length === 0) return;
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await admin.from("email_notification_logs").insert(
    args.recipients.map((recipient) => ({
      recipient,
      notification_type: "upload_log_report",
      status: args.status,
      error_message: args.errorMessage ?? null,
      provider: args.provider ?? null,
      message_id: args.messageId ?? null,
      payload: args.payload,
      resend_of: args.resendOf ?? null,
    })),
  );
  if (error) {
    console.error("[send-upload-log-report-email] log insert", error.message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body: {
    test?: boolean;
    to?: string | string[];
    forward_to?: string;
    include_all_dates?: boolean;
    preview_only?: boolean;
    day_count?: number;
    resend_of?: string;
  } = {};

  let admin: SupabaseClient;
  try {
    admin = furnitureAdmin();
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Server misconfigured" },
      500,
    );
  }

  const denied = await authorizeCaller(req, admin);
  if (denied) return denied;

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  if (!isSafeEmail(DEFAULT_TO)) {
    return jsonResponse({ error: "UPLOAD_LOG_REPORT_TO_EMAIL is not a valid address" }, 500);
  }

  let allowedRecipients: Set<string>;
  try {
    allowedRecipients = await loadAllowedRecipients(admin);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "recipient lookup failed" },
      500,
    );
  }

  const omittedTo = body.to == null
    || (typeof body.to === "string" && !body.to.trim())
    || (Array.isArray(body.to) && body.to.every((entry) => !String(entry ?? "").trim()));
  const to = omittedTo ? [DEFAULT_TO] : normalizeRecipients(body.to, DEFAULT_TO);
  const forwardTo = body.forward_to?.trim() || "";
  if (!recipientsAllowed(to, allowedRecipients) || (forwardTo && !recipientsAllowed([forwardTo], allowedRecipients))) {
    return jsonResponse({ error: "recipient_not_allowed" }, 403);
  }
  const dayCount = Math.min(Math.max(Number(body.day_count) || 30, 1), 30);
  const includeAllDates = body.include_all_dates === true;

  try {
    const report = await fetchUploadLogReportServer(dayCount);
    let text = includeAllDates
      ? formatUploadLogReportAsText(report)
      : formatTodayUploadLogReportAsText(report);
    let html = includeAllDates
      ? formatUploadLogReportAsHtml(report)
      : formatTodayUploadLogReportAsHtml(report);

    const [y, m, d] = report.todayHk.split("-");
    const dateLabel = `${y}/${m}/${d}`;
    const subjectPrefix = body.test ? "[測試] " : "";
    const forwardNotice = forwardTo ? buildForwardNotice(forwardTo) : null;
    const subject = `${subjectPrefix}Shopify 上載產品紀錄 ${dateLabel}（香港時間）${forwardNotice?.subjectSuffix ?? ""}`;

    if (forwardNotice) {
      text = `${forwardNotice.text}${text}`;
      html = `${forwardNotice.html}${html}`;
    }

    if (body.preview_only) {
      return jsonResponse({
        ok: true,
        preview_only: true,
        to,
        subject,
        text,
        html,
        preview_lines: text.split("\n").slice(0, 30),
      });
    }

    const result = await sendReportEmail({ to, subject, text, html });
    const logPayload = {
      test: body.test === true,
      to,
      forward_to: forwardTo || null,
      include_all_dates: includeAllDates,
      day_count: dayCount,
    };
    await recordEmailLogs({
      recipients: to,
      status: "success",
      provider: result.provider,
      messageId: result.id ?? null,
      payload: logPayload,
      resendOf: body.resend_of?.trim() || null,
    });

    return jsonResponse({
      ok: true,
      test: body.test === true,
      to,
      forward_to: forwardTo || null,
      subject,
      provider: result.provider,
      message_id: result.id ?? null,
      preview_lines: text.split("\n").slice(0, 20),
    });
  } catch (err) {
    console.error("[send-upload-log-report-email]", err);
    const message = err instanceof Error ? err.message : "Send failed";
    await recordEmailLogs({
      recipients: to,
      status: "failed",
      errorMessage: message,
      payload: {
        test: body.test === true,
        to,
        forward_to: forwardTo || null,
        include_all_dates: includeAllDates,
        day_count: dayCount,
      },
      resendOf: body.resend_of?.trim() || null,
    });
    return jsonResponse(
      { error: message },
      500,
    );
  }
});
