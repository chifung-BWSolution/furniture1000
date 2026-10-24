#!/usr/bin/env node
/**
 * Import opencode command history into FDS 每日指令記錄.
 *
 * 對照 QMS `scripts/import-command-logs.mjs`：來源是本機 opencode SQLite
 * （~/.local/share/opencode/opencode.db）。一條用戶訊息＝一條指令；完成時間／
 * token／成本由該回合的 assistant 回覆（`parentID` = 用戶訊息 id）聚合。
 * 每條記錄以 external id（`opencode:<message id>`）在伺服器端去重，重跑安全。
 *
 * Usage (from the repo root):
 *   node scripts/import-command-logs.mjs --email you@chifung.net --dry-run
 *   node scripts/import-command-logs.mjs --email you@chifung.net
 *   # options: --since 2026-10-01 --until 2026-10-24 --project "furniture1000"
 *   #          --limit 200 --batch 200 --db <path> --url <fn url> --apikey <key>
 *
 * Config 讀取次序：環境變數 → repo `.env.local`
 *   FDS_DEV_COMMAND_LOG_SECRET  必須（--dry-run 除外）
 *   FDS_DEV_COMMAND_LOG_EMAIL   預設 cfb.app02@chifung.net
 *   FDS_DEV_COMMAND_LOG_PROJECT 預設 "furniture1000"（"-" 表示不限專案）
 *   VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY  端點與 publishable key
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DB = "C:/Users/Administrator/.local/share/opencode/opencode.db";
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

const { values: cli } = parseArgs({
  options: {
    db: { type: "string", default: DEFAULT_DB },
    url: { type: "string" },
    apikey: { type: "string" },
    secret: { type: "string" },
    email: { type: "string" },
    since: { type: "string" },
    until: { type: "string" },
    project: { type: "string" },
    limit: { type: "string" },
    batch: { type: "string", default: "200" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const config = loadLocalConfig();
const url = cli.url ?? config.url;
const apikey = cli.apikey ?? config.apikey;
const email = (cli.email ?? config.email)?.trim().toLowerCase();
const project = cli.project !== undefined ? (cli.project === "-" ? null : cli.project) : config.project;
const secret = cli.secret ?? config.secret ?? "";
const dryRun = cli["dry-run"];
const batchSize = Math.max(1, Math.min(500, Number(cli.batch) || 200));
const limit = cli.limit ? Math.max(0, Number(cli.limit)) : Infinity;

if (cli.help) {
  console.log(
    [
      "node scripts/import-command-logs.mjs [options]",
      "  --since YYYY-MM-DD   只匯入此香港日期或之後的指令",
      "  --until YYYY-MM-DD   只匯入此香港日期或之前的指令",
      "  --project <text>     只匯入 session 目錄包含此文字的指令（- 表示不限）",
      "  --email <addr>       覆寫程式員電郵",
      "  --limit <n>          最多匯入 n 條（方便先試細量）",
      "  --batch <n>          每批上傳筆數（預設 200，上限 500）",
      "  --dry-run            只顯示對應結果，不上傳",
      "",
      "Config：環境變數 → repo .env.local",
      "  鍵名：FDS_DEV_COMMAND_LOG_SECRET / _EMAIL / _PROJECT / _URL / _APIKEY",
    ].join("\n"),
  );
  process.exit(0);
}

if (!dryRun && !email) {
  console.error("缺少 --email：請提供要歸屬的程式員電郵。");
  process.exit(1);
}
if (!dryRun && !secret) {
  console.error("缺少 secret：請設定環境變數 FDS_DEV_COMMAND_LOG_SECRET（或寫入 .env.local）。");
  process.exit(1);
}
if (!dryRun && !apikey) {
  console.error("缺少 apikey：請在 .env.local 設定 VITE_SUPABASE_ANON_KEY（或 --apikey）。");
  process.exit(1);
}

function hkDate(ms) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function toIso(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseModel(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const provider = parsed.providerID ?? parsed.provider;
    const id = parsed.modelID ?? parsed.id;
    if (provider && id) return `${provider}/${id}`;
    return id ?? provider ?? null;
  } catch {
    return String(raw).slice(0, 200);
  }
}

const db = new DatabaseSync(cli.db, { readOnly: true });

const sessions = db
  .prepare("select id, title, slug, directory, model, time_created from session order by time_created asc")
  .all();

const records = [];
let scannedTurns = 0;
let skippedEmpty = 0;
let skippedOutOfRange = 0;
let skippedProject = 0;

for (const session of sessions) {
  if (project && !(session.directory ?? "").toLowerCase().includes(project.toLowerCase())) {
    skippedProject += 1;
    continue;
  }

  const userMessages = db
    .prepare("select id, time_created, data from message where session_id = ? and json_extract(data, '$.role') = 'user' order by time_created asc")
    .all(session.id);
  if (!userMessages.length) continue;

  const assistantMessages = db
    .prepare("select id, data from message where session_id = ? and json_extract(data, '$.role') = 'assistant' order by time_created asc")
    .all(session.id);

  const textByMessage = new Map();
  for (const part of db
    .prepare("select message_id, data from part where session_id = ? and json_extract(data, '$.type') = 'text'")
    .all(session.id)) {
    const text = JSON.parse(part.data).text ?? "";
    if (!text) continue;
    textByMessage.set(part.message_id, (textByMessage.get(part.message_id) ?? "") + text);
  }

  const turnByUser = new Map();
  for (const assistant of assistantMessages) {
    const data = JSON.parse(assistant.data);
    if (!data.parentID) continue;
    const assistantId = assistant.id;
    const turn = turnByUser.get(data.parentID) ?? {
      completedAt: null,
      input: 0,
      cached: 0,
      output: 0,
      cost: 0,
      hasError: false,
      lastText: "",
      model: null,
    };
    const completed = data.time?.completed;
    if (Number.isFinite(completed)) turn.completedAt = Math.max(turn.completedAt ?? 0, completed);
    turn.input += Number(data.tokens?.input) || 0;
    turn.cached += Number(data.tokens?.cache?.read) || 0;
    turn.output += Number(data.tokens?.output) || 0;
    turn.cost += Number(data.cost) || 0;
    if (data.finish === "error") turn.hasError = true;
    if (data.modelID) turn.model = `${data.providerID ?? "unknown"}/${data.modelID}`;
    const text = textByMessage.get(assistantId) ?? "";
    if (text) turn.lastText = text;
    turnByUser.set(data.parentID, turn);
  }

  for (const message of userMessages) {
    scannedTurns += 1;
    const userData = JSON.parse(message.data);
    const started = userData.time?.created ?? message.time_created;
    const businessDate = hkDate(started);
    if (cli.since && businessDate < cli.since) {
      skippedOutOfRange += 1;
      continue;
    }
    if (cli.until && businessDate > cli.until) {
      skippedOutOfRange += 1;
      continue;
    }

    const instruction = (textByMessage.get(message.id) ?? "").trim();
    if (!instruction) {
      skippedEmpty += 1;
      continue;
    }

    const turn = turnByUser.get(message.id);
    const hasReply = Boolean(turn);
    const status = !hasReply ? "failed" : turn.hasError ? "failed" : "completed";
    const startedAt = toIso(started);
    const completedAt = turn?.completedAt ? toIso(turn.completedAt) : startedAt;
    const model =
      turn?.model ??
      parseModel(userData.model ? JSON.stringify(userData.model) : session.model) ??
      parseModel(session.model);

    records.push({
      externalId: `opencode:${message.id}`,
      developerEmail: email ?? "placeholder@example.com",
      instructionText: instruction,
      taskReference: (session.title || session.slug || session.id).slice(0, 300),
      model,
      status,
      startedAt,
      completedAt,
      inputTokens: hasReply ? turn.input : null,
      cachedInputTokens: hasReply ? turn.cached : null,
      outputTokens: hasReply ? turn.output : null,
      costUsd: hasReply ? Number(turn.cost.toFixed(6)) : null,
      resultSummary: hasReply && turn.lastText ? turn.lastText.slice(0, 5000) : null,
      failureReason: !hasReply ? "no_assistant_completion" : turn.hasError ? "assistant_error" : null,
    });

    if (records.length >= limit) break;
  }
  if (records.length >= limit) break;
}

console.log(
  [
    `Sessions: ${sessions.length}（跳過 ${skippedProject} 個不符合 --project）`,
    `使用者指令 turns: ${scannedTurns}`,
    `可匯入: ${records.length}`,
    `跳過（無文字）: ${skippedEmpty}`,
    `跳過（日期範圍外）: ${skippedOutOfRange}`,
  ].join("\n"),
);

if (records.length) {
  const sample = records[0];
  console.log("\n[樣本記錄]");
  console.log(
    JSON.stringify(
      {
        ...sample,
        instructionText: sample.instructionText.slice(0, 120) + (sample.instructionText.length > 120 ? "…" : ""),
        resultSummary: sample.resultSummary ? sample.resultSummary.slice(0, 120) + "…" : null,
      },
      null,
      2,
    ),
  );
}

if (dryRun) {
  console.log("\n[dry-run] 未上傳任何記錄。");
  db.close();
  process.exit(0);
}

async function postBatch(batch) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey,
      "x-fds-dev-log-secret": secret,
    },
    body: JSON.stringify({ action: "ingest_import", records: batch }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

let inserted = 0;
let skipped = 0;
let rejected = 0;
const rejectionSamples = [];

for (let offset = 0; offset < records.length; offset += batchSize) {
  const batch = records.slice(offset, offset + batchSize);
  const result = await postBatch(batch);
  inserted += Number(result.inserted) || 0;
  skipped += Number(result.skipped) || 0;
  rejected += Number(result.rejected) || 0;
  if (Array.isArray(result.rejections)) rejectionSamples.push(...result.rejections);
  console.log(`上傳 ${Math.min(offset + batchSize, records.length)}/${records.length} → inserted ${inserted}, skipped ${skipped}, rejected ${rejected}`);
}

console.log(`\n完成：inserted ${inserted}, skipped（已存在） ${skipped}, rejected ${rejected}`);
if (rejectionSamples.length) {
  console.log("被拒絕樣本：");
  for (const item of rejectionSamples.slice(0, 5)) console.log(`  #${item.index} ${item.error}`);
  if (rejected > 0) process.exitCode = 2;
}

db.close();
