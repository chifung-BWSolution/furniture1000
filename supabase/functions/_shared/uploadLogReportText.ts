import {
  STAGE_LABELS,
  UPLOAD_LOG_STAGES,
  type UploadLogReport,
} from "./uploadLogReportServer.ts";

const STAGE_COL_WIDTH = 14;
const PENDING_COL_WIDTH = 14;

function padEndVis(value: string, width: number): string {
  const chars = Array.from(value);
  if (chars.length >= width) return value;
  return value + " ".repeat(width - chars.length);
}

function formatHkDateLabel(hkDate: string, todayHk?: string): string {
  const [y, m, d] = hkDate.split("-");
  const base = `${y}/${m}/${d}`;
  if (todayHk && hkDate === todayHk) return `${base}（今天）`;
  return base;
}

function formatHkDateTime(date = new Date()): string {
  const hk = date.toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" });
  return hk.replace("T", " ").slice(0, 19);
}

function formatProcessedBlock(
  completedCount: number,
  users: { userName: string; count: number }[],
  isToday: boolean,
): string[] {
  const label = isToday ? "今日已處理" : "當日已處理";
  const lines = [`${label} ${completedCount} 件`];
  for (const user of users) {
    lines.push(`  ${user.userName}  ${user.count} 件`);
  }
  return lines;
}

function formatDaySection(report: UploadLogReport, hkDate: string): string[] {
  const row = report.dailyRows.find((r) => r.hkDate === hkDate);
  if (!row) return [`${formatHkDateLabel(hkDate, report.todayHk)}`, "（尚無紀錄）", ""];

  const isToday = hkDate === report.todayHk;
  const lines: string[] = [
    formatHkDateLabel(hkDate, report.todayHk),
    "",
    `${padEndVis("階段", STAGE_COL_WIDTH)}${padEndVis("產品目前停留", PENDING_COL_WIDTH)}今日已處理`,
    "-".repeat(56),
  ];

  for (const stage of UPLOAD_LOG_STAGES) {
    const stats = row.stages[stage];
    const pending = isToday ? `${report.pendingCounts[stage]} 件` : "—";
    const processed = formatProcessedBlock(stats.completedCount, stats.users, isToday);
    lines.push(
      `${padEndVis(STAGE_LABELS[stage], STAGE_COL_WIDTH)}${padEndVis(pending, PENDING_COL_WIDTH)}${processed[0]}`,
    );
    for (let i = 1; i < processed.length; i++) {
      lines.push(`${" ".repeat(STAGE_COL_WIDTH + PENDING_COL_WIDTH)}${processed[i]}`);
    }
  }

  lines.push("");
  return lines;
}

export function formatUploadLogReportAsText(
  report: UploadLogReport,
  options: { singleDate?: string; dates?: string[] } = {},
): string {
  const generatedLabel = formatHkDateTime(new Date(report.generatedAt));
  const dates = options.singleDate
    ? [options.singleDate]
    : options.dates ?? report.dailyRows.map((r) => r.hkDate);

  const lines: string[] = [
    "Shopify 上載產品紀錄",
    `最近 30 日 · 香港時間 ${formatHkDateTime()}`,
    `資料更新於 ${generatedLabel}（香港時間）`,
    "",
  ];

  for (const hkDate of dates) {
    lines.push(...formatDaySection(report, hkDate));
  }

  lines.push(
    "—",
    "「產品目前停留」僅顯示今天；「今日已處理」按 upload_log / ready_to_shopify / products 時間戳整合。",
  );

  return lines.join("\n");
}

export function formatTodayUploadLogReportAsText(report: UploadLogReport): string {
  return formatUploadLogReportAsText(report, { singleDate: report.todayHk });
}
