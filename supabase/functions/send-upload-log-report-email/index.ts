import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { fetchUploadLogReportServer } from "./uploadLogReportServer.ts";
import { formatTodayUploadLogReportAsHtml, formatUploadLogReportAsHtml } from "./uploadLogReportHtml.ts";
import { formatTodayUploadLogReportAsText, formatUploadLogReportAsText } from "./uploadLogReportText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TO = Deno.env.get("UPLOAD_LOG_REPORT_TO_EMAIL") ?? "brandingworks.ebiz@gmail.com";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRecipients(to: string | string[] | undefined): string[] {
  const raw = Array.isArray(to) ? to : [to ?? DEFAULT_TO];
  const unique = new Set<string>();
  for (const entry of raw) {
    const trimmed = entry?.trim();
    if (trimmed) unique.add(trimmed);
  }
  return unique.size > 0 ? [...unique] : [DEFAULT_TO];
}

function buildForwardNotice(forwardTo: string): { text: string; html: string; subjectSuffix: string } {
  const trimmed = forwardTo.trim();
  return {
    subjectSuffix: `（請轉寄 ${trimmed}）`,
    text: `【請轉寄】此郵件請轉寄至：${trimmed}\n\n`,
    html: `<p style="margin:0 0 16px;padding:12px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;font-size:13px;color:#9a3412;line-height:1.5;"><strong>請轉寄：</strong>此郵件請轉寄至 <a href="mailto:${trimmed}" style="color:#c2410c;">${trimmed}</a></p>`,
  };
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
  } = {};

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const to = normalizeRecipients(body.to);
  const forwardTo = body.forward_to?.trim() || "";
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
    const subject = `${subjectPrefix}上載產品紀錄 ${dateLabel}（香港時間）${forwardNotice?.subjectSuffix ?? ""}`;

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
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Send failed" },
      500,
    );
  }
});
