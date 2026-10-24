#!/usr/bin/env node
/**
 * Import OpenAI Codex (ChatGPT) session history into FDS 每日指令記錄.
 *
 * 對照 QMS `scripts/import-codex-logs.mjs`：Codex 每個 session 是一個
 * `rollout-*.jsonl`（~/.codex/sessions/<yyyy>/<mm>/<dd>/ 及 archived_sessions/）。
 * 一對 `task_started` → `task_complete` = 一條指令：
 *   - instruction = role `user` 的 `response_item` 訊息（略過注入的 `<...>` context），
 *   - start/complete = `task_started.started_at` / `task_complete.completed_at`，
 *   - tokens = 該回合 `token_usage_record.usage` 總和，
 *   - result = `task_complete.last_agent_message`。
 * 以 cwd／workspace 篩選專案；external id（`codex:<session>:<turn>`）伺服器端去重。
 *
 * Usage:
 *   node scripts/import-codex-logs.mjs --project "furniture1000" --dry-run
 *   node scripts/import-codex-logs.mjs --project "furniture1000"
 *
 * Options: --dir <codex home> --archived --since YYYY-MM-DD --until YYYY-MM-DD
 *          --model <name> --limit <n> --batch <n> --url --apikey --secret --dry-run
 *
 * Config：環境變數 → repo .env.local（FDS_DEV_COMMAND_LOG_* / VITE_SUPABASE_*）。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_URL = "https://omxizeukbcqzsnjsuwod.supabase.co/functions/v1/bwf-development-command-logs";
const DEFAULT_EMAIL = "cfb.app02@chifung.net";
const DEFAULT_PROJECT = "furniture1000";

/** Parse `KEY=VALUE` lines from a .env file (comments/blanks ignored, quotes stripped). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Config precedence: process env → repo `.env.local`. */
export function loadLocalConfig({ env = process.env, files = [join(REPO_ROOT, ".env.local")] } = {}) {
  const fromFiles = {};
  for (const file of files) {
    if (!file || !existsSync(file)) continue;
    Object.assign(fromFiles, parseEnvFile(readFileSync(file, "utf8")));
  }
  const pick = (key) => {
    const value = env[key] ?? fromFiles[key];
    return value === undefined || value === null || String(value).trim() === ""
      ? null
      : String(value).trim();
  };
  const project = pick("FDS_DEV_COMMAND_LOG_PROJECT") ?? DEFAULT_PROJECT;
  const baseUrl = (pick("FDS_DEV_COMMAND_LOG_URL") ?? pick("VITE_SUPABASE_URL") ?? "").replace(/\/$/, "");
  return {
    secret: pick("FDS_DEV_COMMAND_LOG_SECRET"),
    email: pick("FDS_DEV_COMMAND_LOG_EMAIL") ?? DEFAULT_EMAIL,
    project: project === "-" ? null : project,
    url: baseUrl ? `${baseUrl}/functions/v1/bwf-development-command-logs` : DEFAULT_URL,
    apikey: pick("FDS_DEV_COMMAND_LOG_APIKEY") ?? pick("VITE_SUPABASE_ANON_KEY"),
  };
}

const INJECTED_PREFIXES = [
  "<app-context>", "<recommended_plugins>", "<environment_context>",
  "<user_instructions>", "<multi_agent_mode>", "<system", "<permissions", "<skill", "<plugins",
  "<world_state", "<turn_context", "<turn_aborted>", "<in-app-browser-context",
  "# agents.md instructions", "the following is the codex agent history",
];

/** Return the real user text, or null for injected/system content. */
export function extractUserText(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (INJECTED_PREFIXES.some((prefix) => lower.startsWith(prefix))) return null;
  // Codex prefixes a file list to the message; keep only the actual request.
  if (lower.startsWith("# files mentioned by the user:")) {
    const marker = "## My request for Codex:";
    const index = trimmed.indexOf(marker);
    if (index === -1) return null;
    return trimmed.slice(index + marker.length).trim() || null;
  }
  return trimmed;
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function hkDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

function collectRolloutFiles(root, includeArchived) {
  const files = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) files.push(full);
    }
  };
  visit(join(root, "sessions"));
  if (includeArchived) visit(join(root, "archived_sessions"));
  return files;
}

/** Parse one rollout file into a session with its turns. */
export function parseCodexSession(text) {
  const lines = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // ignore malformed lines
    }
  }
  const meta = lines.find((line) => line.type === "session_meta")?.payload ?? {};
  const sessionId = meta.session_id || meta.id || "";
  const cwd = meta.cwd || "";
  const roots = Array.isArray(meta.runtime_workspace_roots) ? meta.runtime_workspace_roots : [];

  const turns = new Map();
  const userMessages = [];
  for (const line of lines) {
    const payload = line.payload ?? {};
    if (line.type === "event_msg" && payload.type === "task_started") {
      turns.set(payload.turn_id, {
        turnId: payload.turn_id,
        startedMs: toMs(payload.started_at),
        completedMs: null,
        durationMs: null,
        lastAgent: null,
        usage: { input: 0, cached: 0, output: 0 },
        users: [],
      });
    } else if (line.type === "event_msg" && payload.type === "task_complete") {
      const turn = turns.get(payload.turn_id);
      if (turn) {
        turn.completedMs = toMs(payload.completed_at);
        turn.durationMs = typeof payload.duration_ms === "number" ? payload.duration_ms : null;
        turn.lastAgent = payload.last_agent_message ?? null;
      }
    } else if (line.type === "token_usage_record") {
      const turn = turns.get(payload.turn_id);
      if (turn && payload.usage) {
        turn.usage.input += Number(payload.usage.input_tokens) || 0;
        turn.usage.cached += Number(payload.usage.cached_input_tokens) || 0;
        turn.usage.output += Number(payload.usage.output_tokens) || 0;
      }
    } else if (line.type === "response_item" && payload.type === "message" && payload.role === "user") {
      const text = (payload.content ?? [])
        .filter((part) => part.type === "input_text")
        .map((part) => part.text ?? "")
        .join("");
      const command = extractUserText(text);
      if (command) {
        userMessages.push({ ms: toMs(line.timestamp), text: command });
      }
    }
  }

  const ordered = [...turns.values()].sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0));
  userMessages.sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
  for (const message of userMessages) {
    let chosen = null;
    for (const turn of ordered) {
      if (!turn.startedMs) continue;
      if (message.ms >= turn.startedMs - 5000 && (turn.completedMs === null || message.ms <= turn.completedMs + 5000)) {
        if (!chosen || turn.startedMs > chosen.startedMs) chosen = turn;
      }
    }
    (chosen ?? ordered[0])?.users.push(message.text);
  }

  return { sessionId, cwd, roots, turns: ordered };
}

function recordFromTurn(session, turn, { email, model }) {
  const instruction = turn.users.join("\n\n").trim();
  if (!instruction) return null;
  const startedMs = turn.startedMs ?? turn.completedMs ?? Date.now();
  const completedMs = turn.completedMs;
  const status = completedMs ? "completed" : "running";
  const duration = turn.durationMs !== null
    ? Math.round(turn.durationMs / 1000)
    : completedMs ? Math.max(0, Math.round((completedMs - startedMs) / 1000)) : null;
  return {
    externalId: `codex:${session.sessionId}:${turn.turnId}`,
    developerEmail: email,
    instructionText: instruction.slice(0, 20000),
    taskReference: session.sessionId.slice(0, 300),
    model,
    status,
    startedAt: new Date(startedMs).toISOString(),
    completedAt: completedMs ? new Date(completedMs).toISOString() : (status === "running" ? null : new Date(startedMs).toISOString()),
    inputTokens: turn.usage.input || null,
    cachedInputTokens: turn.usage.cached || null,
    outputTokens: turn.usage.output || null,
    creditsUsed: null,
    costUsd: null,
    resultSummary: turn.lastAgent ? String(turn.lastAgent).slice(0, 5000) : null,
    failureReason: status === "running" ? null : (completedMs ? null : "no_task_complete"),
    durationSeconds: duration,
  };
}

async function postBatch(url, apikey, secret, batch) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", apikey, "x-fds-dev-log-secret": secret },
    body: JSON.stringify({ action: "ingest_import", records: batch }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      dir: { type: "string", default: join(homedir(), ".codex") },
      archived: { type: "boolean", default: false },
      email: { type: "string" },
      project: { type: "string" },
      model: { type: "string", default: "openai" },
      since: { type: "string" },
      until: { type: "string" },
      limit: { type: "string" },
      batch: { type: "string", default: "200" },
      url: { type: "string" },
      apikey: { type: "string" },
      secret: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const config = loadLocalConfig();

  const url = args.url ?? config.url ?? DEFAULT_URL;
  const apikey = args.apikey ?? config.apikey;
  const email = (args.email ?? config.email)?.trim().toLowerCase();
  const project = args.project !== undefined ? (args.project === "-" ? null : args.project) : config.project;
  const secret = args.secret ?? config.secret ?? "";
  const dryRun = args["dry-run"];

  if (args.help || !email) {
    console.log(
      [
        "node scripts/import-codex-logs.mjs [options]",
        "  --project \"furniture1000\"  只匯入 cwd／workspace 含此文字的 session（- 表示不限）",
        "  --archived                 連同 archived_sessions 一併掃描",
        "  --since/--until YYYY-MM-DD 香港日期範圍",
        "  --model <name>             模型標籤（Codex 只記錄 provider，預設 openai）",
        "  --dir <codex home>         預設 ~/.codex",
        "  --email <addr>             覆寫程式員電郵",
        "  --limit/--batch/--dry-run",
        "Config：環境變數 → repo .env.local（FDS_DEV_COMMAND_LOG_* / VITE_SUPABASE_*）。",
      ].join("\n"),
    );
    process.exit(args.help ? 0 : 1);
  }
  if (!dryRun && !secret) {
    console.error("缺少 secret：請設定 FDS_DEV_COMMAND_LOG_SECRET（或寫入 .env.local）。");
    process.exit(1);
  }
  if (!dryRun && !apikey) {
    console.error("缺少 apikey：請在 .env.local 設定 VITE_SUPABASE_ANON_KEY（或 --apikey）。");
    process.exit(1);
  }

  const files = collectRolloutFiles(args.dir, args.archived);
  const records = [];
  let sessions = 0;
  let skippedSessions = 0;
  let skippedTurns = 0;

  for (const file of files) {
    let session;
    try {
      session = parseCodexSession(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!session.turns.length) continue;
    if (project) {
      const haystack = [session.cwd, ...session.roots].join(" ").toLowerCase();
      if (!haystack.includes(project.toLowerCase())) {
        skippedSessions += 1;
        continue;
      }
    }
    sessions += 1;
    for (const turn of session.turns) {
      const record = recordFromTurn(session, turn, { email, model: args.model });
      if (!record) {
        skippedTurns += 1;
        continue;
      }
      const businessDate = hkDate(new Date(record.startedAt).getTime());
      if (args.since && businessDate < args.since) { skippedTurns += 1; continue; }
      if (args.until && businessDate > args.until) { skippedTurns += 1; continue; }
      records.push(record);
    }
  }

  records.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const limit = args.limit ? Math.max(0, Number(args.limit)) : Infinity;
  const sliced = records.slice(0, limit === Infinity ? records.length : limit);

  console.log(`Codex 目錄：${args.dir}${args.archived ? "（含 archived）" : ""}`);
  console.log(`rollout 檔案：${files.length}｜符合專案：${sessions}（略過 ${skippedSessions}）｜可匯入指令：${sliced.length}｜略過 turn：${skippedTurns}`);
  if (sliced[0]) {
    console.log("樣本：");
    console.log(JSON.stringify({ ...sliced[0], instructionText: sliced[0].instructionText.slice(0, 120) }, null, 2));
  }
  if (dryRun) {
    console.log("\n[dry-run] 未上傳。");
    return;
  }
  if (!sliced.length) {
    console.log("沒有可上傳的記錄。");
    return;
  }

  const batchSize = Math.max(1, Math.min(500, Number(args.batch) || 200));
  let inserted = 0;
  let skippedExisting = 0;
  let rejected = 0;
  const rejections = [];
  for (let offset = 0; offset < sliced.length; offset += batchSize) {
    const result = await postBatch(url, apikey, secret, sliced.slice(offset, offset + batchSize));
    inserted += Number(result.inserted) || 0;
    skippedExisting += Number(result.skipped) || 0;
    rejected += Number(result.rejected) || 0;
    if (Array.isArray(result.rejections)) rejections.push(...result.rejections);
    console.log(`上傳 ${Math.min(offset + batchSize, sliced.length)}/${sliced.length} → inserted ${inserted}, skipped ${skippedExisting}, rejected ${rejected}`);
  }
  console.log(`\n完成：inserted ${inserted}, skipped（已存在） ${skippedExisting}, rejected ${rejected}`);
  for (const item of rejections.slice(0, 5)) console.log(`  拒絕 #${item.index} ${item.error}`);
  if (rejected > 0) process.exitCode = 2;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`失敗：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
