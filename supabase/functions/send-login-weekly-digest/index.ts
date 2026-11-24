import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { isSafeEmail, sendEmail } from "../_shared/email.ts";
import {
  aggregateWeeklyLoginLogs,
  buildWeeklyLoginDigestEmail,
  getWeeklyDigestRangeHk,
  type LoginDigestLogRow,
} from "../_shared/loginDigestEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-worker-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_RECIPIENTS = [
  "franco.kaffa@gmail.com",
  "angel.kaffa@gmail.com",
  "cfb.system@chifung.net",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getConfiguredRecipients(): string[] {
  const raw = Deno.env.get("FDS_LOGIN_DIGEST_RECIPIENTS")?.trim();
  if (!raw) return [...DEFAULT_RECIPIENTS];
  const parsed = raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter((s) => isSafeEmail(s));
  return parsed.length > 0 ? [...new Set(parsed.map((s) => s.toLowerCase()))] : [...DEFAULT_RECIPIENTS];
}

function resolveRecipients(rawTo: unknown): string[] {
  const defaults = getConfiguredRecipients();
  if (rawTo == null || rawTo === "") return defaults;
  const list = Array.isArray(rawTo) ? rawTo : [rawTo];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const trimmed = String(item ?? "").trim();
    if (!trimmed) continue;
    if (!isSafeEmail(trimmed)) {
      throw new Error(`Invalid recipient email: ${trimmed}`);
    }
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out.length > 0 ? out : defaults;
}

async function authorizeCaller(
  req: Request,
  admin: SupabaseClient,
): Promise<Response | null> {
  const workerSecret = req.headers.get("x-worker-secret");
  if (workerSecret !== null) {
    const secret = workerSecret.trim();
    if (!secret) return jsonResponse({ error: "Unauthorized" }, 401);
    const { data, error } = await admin.rpc("fds_worker_verify_secret", {
      p_secret: secret,
    });
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
  if (userError || !userData.user?.id) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: allowed, error: roleError } = await userClient.rpc("bwf_has_role", {
    p_roles: ["admin"],
  });
  if (roleError || allowed !== true) {
    return jsonResponse({ error: "permission_denied" }, 403);
  }
  return null;
}

async function fetchWeeklyLoginLogs(
  admin: SupabaseClient,
  rangeStartIso: string,
  rangeEndIso: string,
): Promise<LoginDigestLogRow[]> {
  const pageSize = 1000;
  const rows: LoginDigestLogRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("login_log")
      .select("id, user_id, user_email, user_name, event, login_method, ip_address, logged_at")
      .gte("logged_at", rangeStartIso)
      .lt("logged_at", rangeEndIso)
      .order("logged_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch login_log: ${error.message}`);
    }
    const batch = (data ?? []) as LoginDigestLogRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function fetchProfileNameMaps(admin: SupabaseClient): Promise<{
  nameByUserId: Map<string, string>;
  nameByEmail: Map<string, string>;
}> {
  const nameByUserId = new Map<string, string>();
  const nameByEmail = new Map<string, string>();

  const { data, error } = await admin
    .from("platform_user_profiles")
    .select("auth_user_id, email, display_name");
  if (error) {
    console.warn("[send-login-weekly-digest] profile lookup failed:", error.message);
    return { nameByUserId, nameByEmail };
  }

  for (const row of data ?? []) {
    const p = row as {
      auth_user_id?: string | null;
      email?: string | null;
      display_name?: string | null;
    };
    const name = p.display_name?.trim();
    if (!name) continue;
    if (p.auth_user_id) nameByUserId.set(p.auth_user_id, name);
    if (p.email) nameByEmail.set(p.email.trim().toLowerCase(), name);
  }
  return { nameByUserId, nameByEmail };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders, status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const denied = await authorizeCaller(req, admin);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.trim()) {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        body = parsed as Record<string, unknown>;
      }
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const dryRun = body.dry_run === true || body.preview === true;
  const force = body.force === true;
  const skipIdempotency = body.skip_idempotency === true;

  let recipients: string[];
  try {
    recipients = resolveRecipients(body.to);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Invalid recipients" },
      400,
    );
  }

  let range: ReturnType<typeof getWeeklyDigestRangeHk>;
  try {
    range = getWeeklyDigestRangeHk({
      weekStart: typeof body.week_start === "string" ? body.week_start : undefined,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Invalid week_start" },
      400,
    );
  }

  const [logs, profileMaps] = await Promise.all([
    fetchWeeklyLoginLogs(admin, range.rangeStartIso, range.rangeEndIso),
    fetchProfileNameMaps(admin),
  ]);

  const summary = aggregateWeeklyLoginLogs(logs, {
    ...range,
    nameByUserId: profileMaps.nameByUserId,
    nameByEmail: profileMaps.nameByEmail,
  });

  const emailContent = buildWeeklyLoginDigestEmail(summary, {
    isTest: body.test === true,
  });

  if (dryRun) {
    return jsonResponse({
      ok: true,
      dry_run: true,
      week_start: range.weekStartDate,
      week_end: range.weekEndDate,
      recipients,
      subject: emailContent.subject,
      summary,
      html: emailContent.html,
      text: emailContent.text,
    });
  }

  const results: Array<{
    recipient: string;
    status: "sent" | "skipped_already_sent" | "failed";
    provider?: string;
    provider_id?: string | null;
    error?: string;
  }> = [];

  for (const recipient of recipients) {
    if (!skipIdempotency && !force) {
      const { data: existingRun } = await admin
        .from("fds_login_digest_email_runs")
        .select("status, provider, provider_id")
        .eq("week_start", range.weekStartDate)
        .eq("recipient", recipient)
        .maybeSingle();

      if ((existingRun as { status?: string } | null)?.status === "sent") {
        results.push({
          recipient,
          status: "skipped_already_sent",
          provider: (existingRun as { provider?: string }).provider,
          provider_id: (existingRun as { provider_id?: string | null }).provider_id ?? null,
        });
        continue;
      }
    }

    if (!skipIdempotency) {
      await admin.from("fds_login_digest_email_runs").upsert(
        {
          week_start: range.weekStartDate,
          recipient,
          status: "pending",
          error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "week_start,recipient" },
      );
    }

    try {
      const sent = await sendEmail({
        to: [recipient],
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });

      if (!skipIdempotency) {
        await admin.from("fds_login_digest_email_runs").upsert(
          {
            week_start: range.weekStartDate,
            recipient,
            status: "sent",
            provider: sent.provider,
            provider_id: sent.id,
            error: null,
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "week_start,recipient" },
        );
      }

      results.push({
        recipient,
        status: "sent",
        provider: sent.provider,
        provider_id: sent.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!skipIdempotency) {
        await admin.from("fds_login_digest_email_runs").upsert(
          {
            week_start: range.weekStartDate,
            recipient,
            status: "failed",
            error: msg.slice(0, 1000),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "week_start,recipient" },
        );
      }

      results.push({
        recipient,
        status: "failed",
        error: msg,
      });
    }
  }

  const allSucceeded = results.every((r) => r.status !== "failed");
  return jsonResponse(
    {
      ok: allSucceeded,
      week_start: range.weekStartDate,
      week_end: range.weekEndDate,
      recipients,
      subject: emailContent.subject,
      summary,
      results,
    },
    allSucceeded ? 200 : 500,
  );
});
