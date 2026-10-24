// FDS 每日指令記錄 — 外部工具匯入端點（對照 QMS `qms-development-command-logs`）。
//
// 只服務 ingestion：外部開發／AI 工具（opencode／ChatGPT(Codex)／Cursor／
// WorkBuddy）用共享 secret header `x-fds-dev-log-secret` POST 匯入記錄。
// 不帶 FDS session；開發者由 RPC 依 email 解析，用戶端不送 role／auth id／名字。
// Service-role key 只留在本 function 內。
//
// 讀取／匯出不用此端點：管理頁（DailyCommandLogsView）直接走既有
// `bwf_dev_command_logs_list`／`_analytics` RPC（admin 角色，JWT）。
//
// Actions：
//   ingest_import   → bwf_dev_command_log_import（批量歷史匯入，external_id 去重）
//   ingest_start    → bwf_dev_command_log_start（既有 RPC，沿用）
//   ingest_complete → bwf_dev_command_log_complete（既有 RPC，沿用）
//
// 本 function 設 verify_jwt = false（見 supabase/config.toml）：驗證只靠
// 共享 secret，不留此入口會被 401 擋下。

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SECRET_HEADER = "x-fds-dev-log-secret";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-fds-dev-log-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asText(value: unknown, max = 20000): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function hasIngestSecret(request: Request) {
  const expected = Deno.env.get("FDS_DEV_COMMAND_LOG_SECRET");
  if (!expected) return false;
  const provided = request.headers.get(SECRET_HEADER) || "";
  return provided.length > 0 && safeEqual(provided, expected);
}

function serviceHeaders() {
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

async function callRpc(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "";
    try {
      const parsed = (await response.json()) as { message?: string };
      message = typeof parsed.message === "string" ? parsed.message : "";
    } catch {
      // Non-JSON error body → generic code.
    }
    const known = new Set([
      "invalid_records",
      "too_many_records",
      "developer_email_invalid",
      "instruction_text_required",
      "record_invalid_status",
      "record_instruction_too_long",
      "status_invalid",
      "log_not_open",
    ]);
    if (known.has(message)) throw new Error(message);
    if (response.status === 401 || response.status === 403) throw new Error("permission_denied");
    throw new Error("database_unavailable");
  }
  if (response.status === 204) return {};
  return (await response.json()) as Record<string, unknown>;
}

function normalizeImportRecord(value: unknown) {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    externalId: asText(row.externalId, 300),
    developerEmail: asText(row.developerEmail, 320) ?? "",
    instructionText: asText(row.instructionText, 20000) ?? "",
    taskReference: asText(row.taskReference, 300),
    model: asText(row.model, 200),
    status: asText(row.status, 20),
    startedAt: asText(row.startedAt, 40),
    completedAt: asText(row.completedAt, 40),
    inputTokens: asNumberOrNull(row.inputTokens),
    cachedInputTokens: asNumberOrNull(row.cachedInputTokens),
    outputTokens: asNumberOrNull(row.outputTokens),
    creditsUsed: asNumberOrNull(row.creditsUsed),
    costUsd: asNumberOrNull(row.costUsd),
    resultSummary: asText(row.resultSummary, 5000),
    failureReason: asText(row.failureReason, 2000),
  };
}

async function ingest(payload: Record<string, unknown>) {
  const action = String(payload.action || "");
  if (action === "ingest_import") {
    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!records.length) throw new Error("invalid_records");
    if (records.length > 500) throw new Error("too_many_records");
    return callRpc("bwf_dev_command_log_import", {
      p_records: records.map(normalizeImportRecord),
    });
  }
  if (action === "ingest_start") {
    return callRpc("bwf_dev_command_log_start", {
      p_developer_email: asText(payload.developerEmail, 320) ?? "",
      p_instruction_text: asText(payload.instructionText, 20000) ?? "",
      p_task_reference: asText(payload.taskReference, 300),
      p_model: asText(payload.model, 200),
    });
  }
  if (action === "ingest_complete") {
    return callRpc("bwf_dev_command_log_complete", {
      p_id: asText(payload.id, 40) ?? "",
      p_status: asText(payload.status, 20) ?? "",
      p_model: asText(payload.model, 200),
      p_input_tokens: asNumberOrNull(payload.inputTokens),
      p_cached_input_tokens: asNumberOrNull(payload.cachedInputTokens),
      p_output_tokens: asNumberOrNull(payload.outputTokens),
      p_credits_used: asNumberOrNull(payload.credits),
      p_cost_usd: asNumberOrNull(payload.costUsd),
      p_result_summary: asText(payload.resultSummary, 5000),
      p_failure_reason: asText(payload.failureReason, 2000),
      p_completed_at: asText(payload.completedAt, 40),
    });
  }
  throw new Error("invalid_action");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!hasIngestSecret(request)) return json({ error: "unauthorized" }, 401);
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const result = await ingest(payload);
    if (result && typeof result === "object" && "error" in result) {
      throw new Error(String((result as { error: unknown }).error));
    }
    return json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "command_log_failed";
    const status = code === "unauthorized" || code === "permission_denied"
      ? 401
      : code === "database_unavailable"
      ? 503
      : 400;
    const known = new Set([
      "invalid_action",
      "invalid_records",
      "too_many_records",
      "developer_email_invalid",
      "instruction_text_required",
      "record_invalid_status",
      "record_instruction_too_long",
      "status_invalid",
      "log_not_open",
      "permission_denied",
      "database_unavailable",
    ]);
    return json({ error: known.has(code) ? code : "command_log_failed" }, status);
  }
});
