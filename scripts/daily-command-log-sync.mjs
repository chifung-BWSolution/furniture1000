#!/usr/bin/env node
/**
 * 每日指令記錄同步（opencode ／ ChatGPT(Codex) ／ Cursor ／ WorkBuddy）。
 *
 * 對照 QMS `scripts/daily-command-log-sync.mjs`：逐一呼叫四個 importer，
 * 同步指定香港日（預設＝上一日）的指令記錄到 FDS「每日指令記錄」
 * （edge function `bwf-development-command-logs` 的 `ingest_import`）。
 * 所有 importer 都以 `externalId` 在伺服器端去重，因此重跑、補跑、
 * 範圍重疊都不會產生重複列。
 *
 * Usage（repo root）：
 *   node scripts/daily-command-log-sync.mjs                # 同步上一日
 *   node scripts/daily-command-log-sync.mjs --dry-run      # 只顯示指令，不上傳
 *   node scripts/daily-command-log-sync.mjs --date 2026-10-23
 *   node scripts/daily-command-log-sync.mjs --days 3       # 補跑最近 3 個香港日（含上一日）
 *   node scripts/daily-command-log-sync.mjs --sources opencode,workbuddy
 *   node scripts/daily-command-log-sync.mjs --git          # 照 git commit 日期補跑（開機用）
 *   node scripts/daily-command-log-sync.mjs --git --git-days 365   # 回看 365 日內有 commit 的日子
 *
 * Config（先環境變數，後 repo `.env.local`）：
 *   FDS_DEV_COMMAND_LOG_SECRET   必須（--dry-run 除外）
 *   FDS_DEV_COMMAND_LOG_EMAIL    預設 cfb.app02@chifung.net
 *   FDS_DEV_COMMAND_LOG_PROJECT  預設 "furniture1000"（"-" 表示不限專案）
 *
 * 輸出：console + `tmp/daily-sync/sync-<香港日>.log`，並寫入
 * `tmp/daily-sync/last-run.json` 供排程後檢查。
 */

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOG_DIR = join(REPO_ROOT, "tmp", "daily-sync");
const DEFAULT_EMAIL = "cfb.app02@chifung.net";
const DEFAULT_PROJECT = "furniture1000";

const HK_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Hong Kong civil date (YYYY-MM-DD) for an instant. */
export function hkDateString(ms) {
  return HK_FORMATTER.format(new Date(ms));
}

/**
 * 照 git commit 日期決定要補跑嘅香港日。
 * 邏輯：放假／未開機冇跑排程嗰日，只要嗰段時間有 commit（＝有開工），
 * 開機補跑時就會將嗰日嘅指令記錄補入。去重靠 externalId，重跑安全。
 */
export function gitCommitDates({ repoRoot = REPO_ROOT, lookbackDays = 30, now = Date.now() } = {}) {
  const since = new Date(now - Math.max(1, lookbackDays) * 86_400_000).toISOString();
  let stdout = "";
  try {
    const result = spawnSync(
      "git",
      ["-C", repoRoot, "log", "--all", `--since=${since}`, "--format=%ad", "--date=format-local:%Y-%m-%d"],
      { encoding: "utf8", windowsHide: true },
    );
    stdout = result.stdout ?? "";
  } catch {
    return [];
  }
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d{4}-\d{2}-\d{2}$/.test(line)))].sort();
}

/**
 * Resolve the HK date range to sync.
 * `date` wins; otherwise the last `days` HK days ending yesterday.
 */
export function targetRange({ now = Date.now(), date = null, days = 1 } = {}) {
  const dayMs = 86_400_000;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date 必須是 YYYY-MM-DD：${date}`);
    return { since: date, until: date };
  }
  const count = Math.max(1, Math.min(365, Number(days) || 1));
  return {
    since: hkDateString(now - count * dayMs),
    until: hkDateString(now - dayMs),
  };
}

/** Parse `KEY=VALUE` lines (comments / blanks ignored, quotes stripped). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
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
export function loadConfig({ env = process.env, files = [join(REPO_ROOT, ".env.local")] } = {}) {
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
  return {
    secret: pick("FDS_DEV_COMMAND_LOG_SECRET"),
    email: pick("FDS_DEV_COMMAND_LOG_EMAIL") ?? DEFAULT_EMAIL,
    project: project === "-" ? null : project,
  };
}

/** The four supported sources and where their local data lives. */
export function sources() {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return [
    {
      id: "opencode",
      label: "opencode",
      script: "import-command-logs.mjs",
      dbPath: join(homedir(), ".local", "share", "opencode", "opencode.db"),
      extras: [],
    },
    {
      id: "chatgpt",
      label: "ChatGPT (Codex)",
      script: "import-codex-logs.mjs",
      dbPath: null,
      // Superset scan is safe: upload is deduped by externalId.
      extras: ["--archived"],
    },
    {
      id: "cursor",
      label: "Cursor",
      script: "import-cursor-logs.mjs",
      dbPath: join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      extras: ["--archived"],
    },
    {
      id: "workbuddy",
      label: "WorkBuddy",
      script: "import-workbuddy-logs.mjs",
      dbPath: null, // workbuddy.db 只作輔助，importer 自己處理鎖定
      extras: [],
    },
  ];
}

/** Build the child importer argv (pure, so tests can assert the contract). */
export function buildImportArgs(source, { email, project, since, until, dryRun = false, dbPath = null }) {
  const args = [join(REPO_ROOT, "scripts", source.script)];
  if (email) args.push("--email", email);
  if (project) args.push("--project", project);
  args.push("--since", since, "--until", until);
  if (dbPath) args.push("--db", dbPath);
  for (const extra of source.extras ?? []) args.push(extra);
  if (dryRun) args.push("--dry-run");
  return args;
}

const HK_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Hong_Kong",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function timestamp() {
  return HK_TIME_FORMATTER.format(new Date()).replace(",", "");
}

function runNode(args, { cwd, sink }) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      sink?.(String(chunk));
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      sink?.(String(chunk));
      process.stderr.write(chunk);
    });
    child.on("error", (error) => resolvePromise({ code: 1, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

const LOCK_PATTERN = /database is locked|sqlite|locked|無法開啟|being used|EAGAIN|EPERM|EBUSY/i;

/** Copy a live SQLite database (plus WAL/SHM) so a running app cannot block the read. */
function copyDb(dbPath) {
  const dir = join(LOG_DIR, "db-copy");
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `sync-${Date.now()}-${dbPath.split(/[\\/]/).pop()}`);
  copyFileSync(dbPath, target);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, target + suffix);
  }
  return target;
}

async function syncSource(source, config, range, { dryRun, log, logPath }) {
  const base = {
    email: config.email,
    project: config.project,
    since: range.since,
    until: range.until,
    dryRun,
  };
  const sink = (text) => {
    try {
      appendFileSync(logPath, text, "utf8");
    } catch {
      // logging must never break a sync
    }
  };

  log(`── ${source.label}（${source.script}）`);
  let result = await runNode(buildImportArgs(source, base), { cwd: REPO_ROOT, sink });

  if (result.code !== 0 && source.dbPath && LOCK_PATTERN.test(result.stderr || result.stdout || "")) {
    if (!existsSync(source.dbPath)) {
      log(`   找不到資料檔：${source.dbPath}`);
      return { source: source.id, ok: false, code: result.code, note: "missing_db" };
    }
    log("   資料庫被佔用，改以暫存副本重試…");
    const copy = copyDb(source.dbPath);
    result = await runNode(buildImportArgs(source, { ...base, dbPath: copy }), { cwd: REPO_ROOT, sink });
  }

  const ok = result.code === 0;
  log(ok ? `   完成（exit 0）` : `   失敗（exit ${result.code}）`);
  return { source: source.id, label: source.label, ok, code: result.code };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      date: { type: "string" },
      days: { type: "string", default: "1" },
      sources: { type: "string" },
      email: { type: "string" },
      project: { type: "string" },
      git: { type: "boolean", default: false },
      "git-days": { type: "string", default: "30" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (args.help) {
    console.log(
      [
        "node scripts/daily-command-log-sync.mjs [options]",
        "  --date YYYY-MM-DD   只同步該香港日（預設：上一日）",
        "  --days <n>          同步最近 n 個香港日、以昨日作結（預設 1）",
        "  --git               照 git commit 日期補跑（開機／補跑用，合併每個有 commit 的香港日）",
        "  --git-days <n>      --git 的回看天數（預設 30）",
        "  --sources a,b       只跑指定來源：opencode,chatgpt,cursor,workbuddy（預設全部）",
        "  --email <addr>      覆寫程式員電郵",
        "  --project <text>    覆寫專案篩選（- 表示不限）",
        "  --dry-run           只印出結果，不上傳",
        "",
        "Config 讀取次序：環境變數 → repo .env.local",
        "  鍵名：FDS_DEV_COMMAND_LOG_SECRET / FDS_DEV_COMMAND_LOG_EMAIL / FDS_DEV_COMMAND_LOG_PROJECT",
      ].join("\n"),
    );
    process.exit(0);
  }

  const dryRun = args["dry-run"];
  const gitMode = args.git;
  const gitDays = Math.max(1, Number(args["git-days"]) || 30);

  // git 模式：逐個有 commit 的香港日補跑；否則照 --date/--days。
  const commitDates = gitMode ? gitCommitDates({ lookbackDays: gitDays }) : [];
  const runs = gitMode
    ? commitDates.map((date) => ({ since: date, until: date, label: date }))
    : [(() => {
        const range = targetRange({ date: args.date ?? null, days: args.days });
        return { ...range, label: range.since === range.until ? range.since : `${range.since} ~ ${range.until}` };
      })()];

  const config = loadConfig();
  if (args.email) config.email = args.email;
  if (args.project !== undefined) config.project = args.project === "-" ? null : args.project;

  const wanted = args.sources
    ? new Set(args.sources.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))
    : null;
  const all = sources();
  const selected = wanted ? all.filter((source) => wanted.has(source.id)) : all;
  if (wanted && !selected.length) {
    console.error(`未知來源：${args.sources}（可用：${all.map((source) => source.id).join(",")}）`);
    process.exit(1);
  }

  if (gitMode && commitDates.length === 0) {
    console.log(`git 模式：最近 ${gitDays} 日冇搵到任何 commit，唔使補跑。`);
    process.exit(0);
  }

  if (!dryRun && !config.secret) {
    console.error(
      [
        "缺少 FDS_DEV_COMMAND_LOG_SECRET，無法上傳。",
        "請在 .env.local 加入 FDS_DEV_COMMAND_LOG_SECRET=<secret>（與 Supabase secret 同值）。",
      ].join("\n"),
    );
    process.exit(1);
  }
  if (!config.email.includes("@")) {
    console.error(`程式員電郵無效：${config.email}`);
    process.exit(1);
  }

  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `sync-${gitMode ? `git-${hkDateString(Date.now())}` : runs[0].until}.log`);
  const header = [
    "",
    `===== ${timestamp()}  同步 ${runs.map((run) => run.label).join("、")}${dryRun ? "（dry-run）" : ""} =====`,
    `來源：${selected.map((source) => source.id).join(", ")}｜程式員：${config.email}｜專案：${config.project ?? "不限"}`,
    "",
  ].join("\n");
  appendFileSync(logPath, header, "utf8");
  const log = (line) => {
    console.log(line);
    appendFileSync(logPath, `${line}\n`, "utf8");
  };

  log(`每日指令記錄同步${gitMode ? `（git 模式：${runs.length} 個有 commit 的香港日，回看 ${gitDays} 日）` : ` ${runs[0].label}`}${dryRun ? "（dry-run，不上傳）" : ""}`);
  log(`來源：${selected.map((source) => source.label).join("、")}`);
  log(`程式員：${config.email}｜專案：${config.project ?? "不限"}`);
  if (!config.secret && dryRun) log("（dry-run：未提供 secret，仍會計算可匯入記錄）");

  const results = [];
  for (const run of runs) {
    if (gitMode) log(`── 香港日 ${run.label}`);
    for (const source of selected) {
      results.push(await syncSource(source, config, run, { dryRun, log, logPath }));
    }
  }

  const failed = results.filter((item) => !item.ok);
  const summary = {
    ranAt: new Date().toISOString(),
    gitMode,
    dates: runs.map((run) => run.label),
    dryRun,
    project: config.project,
    email: config.email,
    results,
    ok: failed.length === 0,
  };
  writeFileSync(join(LOG_DIR, "last-run.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  log("");
  log(
    failed.length === 0
      ? `完成：${results.length} 個來源全部成功（log：${logPath}）`
      : `完成：${results.length - failed.length}/${results.length} 成功，失敗 ${failed.map((item) => item.source).join(", ")}（log：${logPath}）`,
  );
  process.exit(failed.length === 0 ? 0 : 2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(`失敗：${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
