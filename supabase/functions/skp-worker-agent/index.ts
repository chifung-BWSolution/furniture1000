import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createHash } from "node:crypto";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Restricted proxy for a paired SKP Worker.
 * The installer and worker never receive a service role key. This function
 * holds that key and only forwards generate_skp / preview_skp operations
 * after the database has checked the device credential and job lease.
 * Codex jobs (payload.mode = codex_v1) upload a manifest of artifacts and publish them together.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PRODUCTION_REF = "riaubhtruisbwdlwjzur";
const BRANCH_REF = "omxizeukbcqzsnjsuwod";
const MAX_OBJECT_BYTES = 100 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function projectOf(url: string) {
  const ref = new URL(url).hostname.split(".")[0] ?? "";
  if (ref === PRODUCTION_REF) return { ref, environment: "production" as const };
  if (ref === BRANCH_REF) return { ref, environment: "branch" as const };
  return { ref, environment: "unknown" as const };
}

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  return forwarded.split(",")[0]?.trim().slice(0, 64) ?? "";
}

function bearer(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? "";
}

function statusFor(error: string) {
  if (error === "rate_limited") return 429;
  if (error === "unauthorized" || error === "revoked" || error === "expired" || error === "suspended") return 401;
  if (error === "forbidden" || error === "lease_rejected" || error === "upload_rejected" || error === "environment_mismatch") return 403;
  if (error === "not_found") return 404;
  if (error === "artifact_missing") return 409;
  return 400;
}

async function rpc(admin: ReturnType<typeof createClient>, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`skp-worker-agent ${fn} failed`, error.code ?? "rpc");
    return { error: "unavailable" };
  }
  return (data ?? {}) as Record<string, unknown>;
}

async function signDownload(supabaseUrl: string, serviceKey: string, path: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/product-models/${encoded}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 300 }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { signedURL?: string };
  if (!body.signedURL) return null;
  const signed = body.signedURL.startsWith("http")
    ? body.signedURL
    : `${supabaseUrl}/storage/v1${body.signedURL}`;
  return signed;
}

async function signUpload(supabaseUrl: string, serviceKey: string, path: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/product-models/${encoded}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 300, upsert: true }),
  });
  if (!response.ok) return null;
  const body = await response.json() as { url?: string; token?: string };
  if (!body.token) return null;
  return { token: body.token, path };
}

async function objectMatches(supabaseUrl: string, serviceKey: string, path: string, size: number, hash: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${supabaseUrl}/storage/v1/object/product-models/${encoded}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!response.ok || !response.body) return false;
  const digest = createHash("sha256");
  let total = 0;
  const reader = response.body.getReader();
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_OBJECT_BYTES) {
      await reader.cancel();
      return false;
    }
    digest.update(step.value);
  }
  return total === size && digest.digest("hex") === hash;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return json({ error: "unavailable" }, 500);
  const project = projectOf(supabaseUrl);
  if (project.environment === "unknown") return json({ error: "environment_mismatch" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_request" }, 400);
  }
  const action = String(body.action ?? "");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const access = bearer(req);

  const finish = async (name: string, args: Record<string, unknown>) => {
    const result = await rpc(admin, name, args);
    const error = typeof result.error === "string" ? result.error : "";
    if (error) return json(result, statusFor(error));
    return json(result);
  };

  if (action === "pair") {
    if (body.environment !== project.environment) return json({ error: "environment_mismatch" }, 403);
    const result = await rpc(admin, "fds_skp_device_pair_start", {
      p_installation_id: body.installation_id,
      p_device_secret: body.device_secret,
      p_computer_name: body.computer_name,
      p_environment: project.environment,
      p_project_ref: project.ref,
      p_ip: clientIp(req),
    });
    if (typeof result.error === "string") return json(result, statusFor(result.error));
    // 測試環境是本機 FDS（Vite port 8080），不是 develop preview。
    const origin = project.environment === "production"
      ? "https://www.bwteam-furniture.com"
      : "http://127.0.0.1:8080";
    console.log("skp-worker-agent pair", project.environment);
    return json({ ...result, authorize_url: `${origin}/fds/settings/skp-workers?code=${result.code}` });
  }

  if (action === "poll") {
    return finish("fds_skp_device_pair_poll", {
      p_installation_id: body.installation_id,
      p_device_secret: body.device_secret,
      p_project_ref: project.ref,
    });
  }
  if (action === "cancel") {
    return finish("fds_skp_device_pair_cancel", {
      p_installation_id: body.installation_id,
      p_device_secret: body.device_secret,
    });
  }
  if (action === "ack") {
    return finish("fds_skp_device_pair_ack", {
      p_installation_id: body.installation_id,
      p_device_secret: body.device_secret,
    });
  }
  if (action === "refresh") {
    return finish("fds_skp_device_refresh", {
      p_device_id: body.device_id,
      p_refresh_token: body.refresh_token,
      p_next_refresh_token: body.next_refresh_token,
      p_rotation_id: body.rotation_id,
    });
  }
  if (action === "refresh-ack") {
    return finish("fds_skp_device_refresh_ack", {
      p_device_id: body.device_id,
      p_refresh_token: body.refresh_token,
    });
  }
  if (action === "disconnect") return finish("fds_skp_device_disconnect", { p_access_token: access });
  if (action === "status") return finish("fds_skp_device_status", { p_access_token: access });
  if (action === "ready") {
    return finish("fds_skp_device_ready", {
      p_access_token: access,
      p_ready: body.ready === true,
      p_checks: body.checks ?? null,
      p_version: body.version ?? "",
    });
  }
  if (action === "claim") return finish("fds_skp_device_claim", { p_access_token: access });
  if (action === "heartbeat") {
    if (typeof body.stage === "string" && body.stage) {
      return finish("fds_skp_device_job_stage", {
        p_access_token: access,
        p_lease_id: body.lease_id,
        p_stage: body.stage,
        p_progress: body.progress ?? null,
        p_detail: typeof body.detail === "string" ? body.detail : null,
      });
    }
    return finish("fds_skp_device_job_touch", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_progress: body.progress ?? null,
    });
  }
  // Codex jobs upload several files per lease. Paths are chosen by the database, never by the Worker.
  if (action === "artifact-upload") {
    const prepared = await rpc(admin, "fds_skp_device_artifact_prepare", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_role: body.role,
      p_content_hash: body.content_hash,
      p_size_bytes: body.size_bytes,
    });
    if (typeof prepared.error === "string") return json(prepared, statusFor(prepared.error));
    const path = String(prepared.storage_path ?? "");
    const signed = await signUpload(supabaseUrl, serviceKey, path);
    if (!signed) return json({ error: "unavailable" }, 502);
    return json({ ok: true, path, token: signed.token, expires_in: 300 });
  }
  if (action === "artifact-download") {
    const result = await rpc(admin, "fds_skp_device_artifact_path", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_role: body.role,
    });
    if (typeof result.error === "string") return json(result, statusFor(result.error));
    const signed = await signDownload(supabaseUrl, serviceKey, String(result.storage_path ?? ""));
    if (!signed) return json({ error: "unavailable" }, 502);
    return json({ ok: true, url: signed, expires_in: 300 });
  }
  if (action === "publish") {
    return finish("fds_skp_device_publish", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_manifest_hash: body.manifest_hash,
      p_verify_only: body.verify_only === true,
    });
  }
  if (action === "fail") {
    return finish("fds_skp_device_job_fail", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_error: body.error ?? "failed",
      p_retryable: body.retryable !== false,
    });
  }
  if (action === "input") {
    const result = await rpc(admin, "fds_skp_device_input", {
      p_access_token: access,
      p_lease_id: body.lease_id,
    });
    if (typeof result.error === "string") return json(result, statusFor(result.error));
    const path = String(result.storage_path ?? "");
    const signed = await signDownload(supabaseUrl, serviceKey, path);
    if (!signed) return json({ error: "unavailable" }, 502);
    return json({ ok: true, url: signed, expires_in: 300 });
  }
  if (action === "upload") {
    const prepared = await rpc(admin, "fds_skp_device_prepare_upload", {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_content_hash: body.content_hash,
      p_size_bytes: body.size_bytes,
    });
    if (typeof prepared.error === "string") return json(prepared, statusFor(prepared.error));
    const path = String(prepared.storage_path ?? "");
    const signed = await signUpload(supabaseUrl, serviceKey, path);
    if (!signed) return json({ error: "unavailable" }, 502);
    return json({ ok: true, path, token: signed.token, expires_in: 300 });
  }
  if (action === "complete") {
    const path = String(body.storage_path ?? "");
    const hash = String(body.content_hash ?? "");
    const size = Number(body.size_bytes ?? 0);
    const args = {
      p_access_token: access,
      p_lease_id: body.lease_id,
      p_content_hash: hash,
      p_size_bytes: size,
      p_storage_path: path,
    };
    const authorization = await rpc(admin, "fds_skp_device_complete", { ...args, p_verify_only: true });
    if (typeof authorization.error === "string") return json(authorization, statusFor(authorization.error));
    if (authorization.ok !== true) return json({ error: "lease_rejected" }, 403);
    if (authorization.idempotent === true) return json(authorization);
    if (authorization.verified !== true) return json({ error: "lease_rejected" }, 403);
    const matches = await objectMatches(supabaseUrl, serviceKey, path, size, hash);
    if (!matches) return json({ error: "upload_rejected" }, 403);
    // Recheck inside the transaction in case the device/lease changed during download.
    return finish("fds_skp_device_complete", args);
  }

  return json({ error: "invalid_request" }, 400);
});
