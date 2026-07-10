import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { fetchUploadLogReportServer } from "./uploadLogReportServer.ts";
import { formatTodayUploadLogReportAsText, formatUploadLogReportAsText } from "./uploadLogReportText.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_TO = "brandingworks.ebiz@gmail.com";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendEmailViaResend(args: {
  to: string;
  subject: string;
  text: string;
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
      to: [args.to],
      subject: args.subject,
      text: args.text,
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
    to?: string;
    include_all_dates?: boolean;
    preview_only?: boolean;
    day_count?: number;
  } = {};

  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const to = (body.to?.trim() || DEFAULT_TO);
  const dayCount = Math.min(Math.max(Number(body.day_count) || 30, 1), 30);
  const includeAllDates = body.include_all_dates === true;

  try {
    const report = await fetchUploadLogReportServer(dayCount);
    const text = includeAllDates
      ? formatUploadLogReportAsText(report)
      : formatTodayUploadLogReportAsText(report);

    const [y, m, d] = report.todayHk.split("-");
    const dateLabel = `${y}/${m}/${d}`;
    const subjectPrefix = body.test ? "[測試] " : "";
    const subject = `${subjectPrefix}上載產品紀錄 ${dateLabel}（香港時間）`;

    if (body.preview_only) {
      return jsonResponse({
        ok: true,
        preview_only: true,
        to,
        subject,
        text,
        preview_lines: text.split("\n").slice(0, 30),
      });
    }

    const result = await sendEmailViaResend({ to, subject, text });

    return jsonResponse({
      ok: true,
      test: body.test === true,
      to,
      subject,
      resend_id: result.id ?? null,
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
