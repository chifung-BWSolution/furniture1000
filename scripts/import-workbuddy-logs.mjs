#!/usr/bin/env node
/**
 * Import WorkBuddy session commands into FDS 每日指令記錄.
 *
 * WorkBuddy 把每個 session 存成 JSONL：
 *   - `~/.workbuddy/projects/<workspace-slug>/<sessionId>.jsonl`
 *     一行一個事件；`type: "message"` + `role: "user"` 是用戶輸入
 *     （`content[].text`、`timestamp`、`sessionId`、`cwd`、
 *     `providerData.startsNewUserRequest`）。
 *   - `~/.workbuddy/workbuddy.db`（SQLite）提供 session 標題與模型
 *     （`sessions.title / custom_title / model`），只作輔助，鎖住就略過。
 *
 * 一條真實用戶指令 = 一條記錄：剝掉 `<system-reminder>` 注入塊後，有
 * `<user_query>` 就取其內文，否則取剩餘文字；空文本（純 context 注入）略過。
 * 完成時間 = 同檔案內下一個有 timestamp 的事件；沒有就視為 running。
 * WorkBuddy 本機不記 token／成本，留空；模型取自 workbuddy.db sessions.model。
 * external id（`workbuddy:<sessionId>:<messageId>`）伺服器端去重，重跑安全。
 *
 * Usage:
 *   node scripts/import-workbuddy-logs.mjs --project "furniture1000" --dry-run
 *   node scripts/import-workbuddy-logs.mjs --project "furniture1000"
 *
 * Options: --dir <projects root> --db <workbuddy.db> --project <text>
 *          --since --until --limit --batch --url --apikey --secret --dry-run
 *
 * Config：環境變數 → repo .env.local（FDS_DEV_COMMAND_LOG_* / VITE_SUPABASE_*）。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

export function defaultProjectsRoot() {
  return join(homedir(), ".workbuddy", "projects");
}

export function defaultDb() {
  return join(homedir(), ".workbuddy", "workbuddy.db");
}

/** Copy a live SQLite database (plus WAL/SHM) so a running app cannot block the read. */
export function copyDb(dbPath, tmpDir) {
  mkdirSync(tmpDir, { recursive: true });
  const target = join(tmpDir, `wb-${Date.now()}-${dbPath.split(/[\\/]/).pop()}`);
  copyFileSync(dbPath, target);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, target + suffix);
  }
  return target;
}

/**
 * Extract the real user command from a raw WorkBuddy user text.
 * 剝掉 system-reminder 注入塊；<user_query> 內文優先。Pure → testable.
 */
export function extractUserText(raw) {
  let text = String(raw ?? "");
  // WorkBuddy wraps host-injected context in <system-reminder ...>...</system-reminder>.
  text = text.replace(/<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g, "");
  // 撇掉常見注餘的 host 標籤塊（id_context / task 通知等）。
  text = text.replace(/<identity_context>[\s\S]*?<\/identity_context>/g, "");
  text = text.replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "");
  text = text.trim();
  if (!text) return null;
  const queryMatch = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (queryMatch) {
    const inner = queryMatch[1].trim();
    return inner || null;
  }
  if (text.startsWith("<")) return null; // 剩低嘅係未識別嘅注入塊
  return text;
}

function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function hkDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/** Collect all session JSONL files under the projects root. */
export function collectSessionFiles(root) {
  const files = [];
  let dirs = [];
  try {
    dirs = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return files;
  }
  for (const dir of dirs) {
    let entries = [];
    try {
      entries = readdirSync(join(root, dir.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      // 只收 <uuid>.jsonl（排除 <uuid>.file-rollback.ndjson 等）
      if (entry.isFile() && /^[0-9a-f-]{36}\.jsonl$/i.test(entry.name)) {
        files.push(join(root, dir.name, entry.name));
      }
    }
  }
  return files;
}

/** Parse one session JSONL into { sessionId, cwds, commands[] }. */
export function parseSession(text) {
  let entries = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      entries.push(JSON.parse(raw));
    } catch {
      // ignore malformed lines
    }
  }
  const sessionId = entries.find((entry) => entry.sessionId)?.sessionId ?? "";
  const cwds = new Set();
  for (const entry of entries) {
    if (entry.cwd) cwds.add(String(entry.cwd));
  }

  const timed = entries
    .map((entry) => ({ entry, ms: toMs(entry.timestamp) }))
    .filter((item) => item.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  const commands = [];
  for (let index = 0; index < timed.length; index += 1) {
    const { entry, ms } = timed[index];
    if (entry.type !== "message" || entry.role !== "user") continue;
    const content = Array.isArray(entry.content) ? entry.content : [];
    const rawText = content
      .filter((part) => part.type === "input_text" || part.type === "text")
      .map((part) => part.text ?? "")
      .join("");
    const instruction = extractUserText(rawText);
    if (!instruction) continue;
    // 完成時間 = 呢輪 turn 嘅最後一個事件（即下一條 user message 之前）；
    // 淨返嘅（最後一條指令）就用檔案內最後一個事件。直接取「下一個事件」
    // 會撞啱 file-history-snapshot（+1 秒），令時長全部變 0–3 秒。
    let completedMs = null;
    for (let next = index + 1; next < timed.length; next += 1) {
      const candidate = timed[next];
      if (candidate.entry.type === "message" && candidate.entry.role === "user") break;
      if (candidate.ms > ms) completedMs = candidate.ms;
    }
    commands.push({
      messageId: entry.id ?? `${sessionId}:${ms}`,
      ms,
      completedMs,
      instruction,
      cwd: entry.cwd ?? [...cwds][0] ?? "",
    });
  }
  return { sessionId, cwds: [...cwds], commands };
}

function recordFromCommand(command, session, meta, { email }) {
  const startedMs = command.ms;
  const completedMs = command.completedMs;
  const status = completedMs ? "completed" : "running";
  const model = meta?.model ? String(meta.model).slice(0, 200) : null;
  const title = meta?.title || session.sessionId;
  return {
    externalId: `workbuddy:${session.sessionId}:${command.messageId}`.slice(0, 300),
    developerEmail: email,
    instructionText: command.instruction.slice(0, 20000),
    taskReference: title.slice(0, 300),
    model,
    status,
    startedAt: new Date(startedMs).toISOString(),
    completedAt: completedMs ? new Date(completedMs).toISOString() : (status === "running" ? null : new Date(startedMs).toISOString()),
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    creditsUsed: null,
    costUsd: null,
    resultSummary: null,
    failureReason: null,
    durationSeconds: completedMs ? Math.max(0, Math.round((completedMs - startedMs) / 1000)) : null,
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
      dir: { type: "string" },
      db: { type: "string" },
      email: { type: "string" },
      project: { type: "string" },
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
        "node scripts/import-workbuddy-logs.mjs [options]",
        "  --project \"furniture1000\"  只匯入 cwd 含此文字的 session（- 表示不限）",
        "  --dir <projects root>      預設 ~/.workbuddy/projects",
        "  --db <workbuddy.db>        預設 ~/.workbuddy/workbuddy.db（只取標題／模型）",
        "  --since/--until YYYY-MM-DD 香港日期範圍",
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

  // workbuddy.db 可能被正在執行的 WorkBuddy 鎖住 → 先抄副本；失敗就無標題／模型照樣跑。
  const dbPath = args.db || defaultDb();
  let db = null;
  if (existsSync(dbPath)) {
    try {
      db = new DatabaseSync(copyDb(dbPath, join(REPO_ROOT, "tmp", "daily-sync", "db-copy")), { readOnly: true });
    } catch {
      db = null;
    }
  }
  const metaBySession = new Map();
  if (db) {
    try {
      for (const row of db.prepare("select id, title, custom_title, model from sessions").all()) {
        metaBySession.set(row.id, { title: row.custom_title || row.title || "", model: row.model ?? null });
      }
    } catch {
      // 標題／模型只係輔助
    }
  }

  const root = args.dir || defaultProjectsRoot();
  const files = collectSessionFiles(root);
  const records = [];
  let sessions = 0;
  let skippedSessions = 0;
  let skippedCommands = 0;

  for (const file of files) {
    let session;
    try {
      session = parseSession(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!session.commands.length) continue;
    if (project) {
      const haystack = session.cwds.join(" ").toLowerCase();
      if (!haystack.includes(project.toLowerCase())) {
        skippedSessions += 1;
        continue;
      }
    }
    sessions += 1;
    const meta = metaBySession.get(session.sessionId) ?? null;
    for (const command of session.commands) {
      const record = recordFromCommand(command, session, meta, { email });
      const businessDate = hkDate(new Date(record.startedAt).getTime());
      if (args.since && businessDate < args.since) { skippedCommands += 1; continue; }
      if (args.until && businessDate > args.until) { skippedCommands += 1; continue; }
      records.push(record);
    }
  }
  if (db) db.close();

  records.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const limit = args.limit ? Math.max(0, Number(args.limit)) : Infinity;
  const sliced = records.slice(0, limit === Infinity ? records.length : limit);

  console.log(`WorkBuddy 目錄：${root}`);
  console.log(`session 檔案：${files.length}｜符合專案：${sessions}（略過 ${skippedSessions}）｜可匯入指令：${sliced.length}｜略過：${skippedCommands}${db ? "" : "（workbuddy.db 讀不到，無標題／模型）"}`);
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
