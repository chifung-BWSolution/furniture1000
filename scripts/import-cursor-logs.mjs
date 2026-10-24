#!/usr/bin/env node
/**
 * Import Cursor Composer/Agent history into FDS 每日指令記錄.
 *
 * 對照 QMS `scripts/import-cursor-logs.mjs`：Cursor 的對話資料在本機 VS Code
 * global state SQLite（%APPDATA%\Cursor\User\globalStorage\state.vscdb）：
 *   - table `composerHeaders`   → 每個對話一行（id, workspace, times）
 *   - key   `composerData:<id>` → 對話 JSON（name, modelConfig, workspace）
 *   - key   `bubbleId:<id>:<bid>` → 一條訊息；`type: 1` 是用戶指令
 *     （`text`, `createdAt`, `modelInfo.modelName`），`type: 2` 是 assistant。
 * 一個用戶 bubble = 一條指令。Cursor 本機不記 token／成本，留空；模型取自
 * `modelConfig.modelName`。external id（`cursor:<composer>:<bubble>`）去重。
 *
 * Usage:
 *   node scripts/import-cursor-logs.mjs --project "furniture1000" --dry-run
 *   node scripts/import-cursor-logs.mjs --project "furniture1000"
 *
 * Options: --db <state.vscdb> --project <text> --archived --since --until
 *          --model-fallback <name> --limit --batch --url --apikey --secret --dry-run
 *
 * Config：環境變數 → repo .env.local（FDS_DEV_COMMAND_LOG_* / VITE_SUPABASE_*）。
 * 注意：請先完全關閉 Cursor，否則 state.vscdb 可能被鎖（daily sync 會自動改用副本）。
 */

import { existsSync, readFileSync } from "node:fs";
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

function defaultDb() {
  const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

function toMs(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * `.code-workspace` / workspace.json 檔案 → folders[] 路徑。
 * 新版 Cursor 嘅 `workspaceIdentifier` 唔再直接俾專案路徑，只有
 * `configPath`（指去 `*.code-workspace`），要先讀檔先知實際 folder。
 */
const workspaceFileCache = new Map();
function resolveWorkspaceFile(fsPath) {
  const key = String(fsPath);
  if (workspaceFileCache.has(key)) return workspaceFileCache.get(key);
  let folders = "";
  try {
    const raw = readFileSync(key.replace(/\\/g, "/"), "utf8");
    const parsed = JSON.parse(raw);
    const paths = (parsed.folders ?? [])
      .map((folder) => folder.path ?? folder.uri ?? "")
      .filter(Boolean);
    folders = paths.join(" ");
  } catch {
    // unreadable / missing file → no folder info
  }
  workspaceFileCache.set(key, folders);
  return folders;
}

function hkDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(ms));
}

/** Build ingest records from one composer + its parsed bubbles. Pure → testable. */
export function buildRecords(composer, bubbles, { email, modelFallback = null } = {}) {
  const ordered = [...bubbles].sort((a, b) => (a.createdAtMs ?? 0) - (b.createdAtMs ?? 0));
  const records = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const bubble = ordered[index];
    if (bubble.type !== 1) continue;
    const text = String(bubble.text ?? "").trim();
    if (!text) continue;
    let completedMs = null;
    for (let next = index + 1; next < ordered.length; next += 1) {
      if (ordered[next].createdAtMs) { completedMs = ordered[next].createdAtMs; break; }
    }
    if (completedMs === null) completedMs = composer.lastUpdatedMs ?? null;
    const startedMs = bubble.createdAtMs ?? completedMs ?? Date.now();
    const model = bubble.modelName || composer.model || modelFallback || null;
    const inputTokens = Number(bubble.inputTokens) > 0 ? Number(bubble.inputTokens) : null;
    const outputTokens = Number(bubble.outputTokens) > 0 ? Number(bubble.outputTokens) : null;
    records.push({
      externalId: `cursor:${composer.composerId}:${bubble.bubbleId}`,
      developerEmail: email,
      instructionText: text.slice(0, 20000),
      taskReference: (composer.name || composer.composerId).slice(0, 300),
      model: model ? String(model).slice(0, 200) : null,
      status: completedMs ? "completed" : "running",
      startedAt: new Date(startedMs).toISOString(),
      completedAt: completedMs ? new Date(completedMs).toISOString() : null,
      inputTokens,
      cachedInputTokens: null,
      outputTokens,
      creditsUsed: null,
      costUsd: null,
      resultSummary: null,
      failureReason: null,
      durationSeconds: completedMs ? Math.max(0, Math.round((completedMs - startedMs) / 1000)) : null,
    });
  }
  return records;
}

function readComposers(db) {
  const headers = db.prepare('select composerId, createdAt, lastUpdatedAt, isArchived from "composerHeaders"').all();
  const composers = [];
  for (const header of headers) {
    const dataRow = db.prepare("select value from cursorDiskKV where key = ?").get(`composerData:${header.composerId}`);
    if (!dataRow) continue;
    let data;
    try { data = JSON.parse(dataRow.value); } catch { continue; }
    const identifier = data.workspaceIdentifier ?? {};
    const uri = identifier.uri ?? {};
    const configPath = identifier.configPath?.fsPath ?? identifier.configPath?.path ?? null;
    const parts = [
      typeof identifier === "string" ? identifier : "",
      identifier.id,
      identifier.name,
      typeof uri === "string" ? uri : "",
      uri.fsPath,
      uri.external,
      uri.path,
      configPath ? resolveWorkspaceFile(configPath) : "",
    ].filter(Boolean).map(String);
    let workspace = parts.join(" ");
    try {
      workspace += ` ${decodeURIComponent(workspace)}`;
    } catch {
      // ignore malformed percent-encoding
    }
    composers.push({
      composerId: header.composerId,
      name: data.name ?? "",
      model: data.modelConfig?.modelName ?? null,
      workspace,
      createdAt: toMs(header.createdAt ?? data.createdAt),
      lastUpdatedMs: toMs(header.lastUpdatedAt ?? data.lastUpdatedAt),
      isArchived: Boolean(header.isArchived),
    });
  }
  return composers;
}

function readBubbles(db, composerId) {
  const rows = db.prepare("select value from cursorDiskKV where key like ?").all(`bubbleId:${composerId}:%`);
  const bubbles = [];
  for (const row of rows) {
    let data;
    try { data = JSON.parse(row.value); } catch { continue; }
    bubbles.push({
      bubbleId: data.bubbleId ?? "",
      type: data.type,
      text: data.text ?? "",
      createdAtMs: toMs(data.createdAt),
      modelName: data.modelInfo?.modelName ?? null,
      inputTokens: data.tokenCount?.inputTokens ?? null,
      outputTokens: data.tokenCount?.outputTokens ?? null,
    });
  }
  return bubbles;
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
      db: { type: "string" },
      email: { type: "string" },
      project: { type: "string" },
      archived: { type: "boolean", default: false },
      "model-fallback": { type: "string", default: "" },
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
        "node scripts/import-cursor-logs.mjs [options]",
        "  --project \"furniture1000\"  只匯入 workspace 路徑含此文字的 composer（- 表示不限）",
        "  --db <state.vscdb>         預設 %APPDATA%\\Cursor\\User\\globalStorage\\state.vscdb",
        "  --archived                 連同已封存 composer",
        "  --since/--until YYYY-MM-DD 香港日期範圍",
        "  --model-fallback <name>    composer 無 model 時的標籤",
        "  --email <addr>             覆寫程式員電郵",
        "  --limit/--batch/--dry-run",
        "Config：環境變數 → repo .env.local（FDS_DEV_COMMAND_LOG_* / VITE_SUPABASE_*）。",
        "注意：請先完全關閉 Cursor，否則 state.vscdb 可能被鎖。",
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

  const dbPath = args.db || defaultDb();
  if (!existsSync(dbPath)) {
    console.error(`找不到 state.vscdb：${dbPath}`);
    process.exit(1);
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (error) {
    console.error(`無法開啟 ${dbPath}（請先關閉 Cursor）：${error.message}`);
    process.exit(1);
  }

  const composers = readComposers(db);
  const records = [];
  let matched = 0;
  for (const composer of composers) {
    if (composer.isArchived && !args.archived) continue;
    if (project && !composer.workspace.toLowerCase().includes(project.toLowerCase())) continue;
    matched += 1;
    const bubbles = readBubbles(db, composer.composerId);
    records.push(...buildRecords(composer, bubbles, { email, modelFallback: args["model-fallback"] || null }));
  }
  db.close();

  const filtered = records.filter((record) => {
    const date = hkDate(new Date(record.startedAt).getTime());
    if (args.since && date < args.since) return false;
    if (args.until && date > args.until) return false;
    return true;
  });
  filtered.sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  const limit = args.limit ? Math.max(0, Number(args.limit)) : Infinity;
  const sliced = filtered.slice(0, limit === Infinity ? filtered.length : limit);

  console.log(`state.vscdb：${dbPath}`);
  console.log(`composer 總數：${composers.length}｜符合專案：${matched}｜可匯入指令：${sliced.length}`);
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
