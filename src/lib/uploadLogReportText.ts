import type { UploadLogStage } from '@/lib/uploadLog';
import {
  formatHkDateLabel,
  formatHkDateTime,
  STAGE_LABELS,
  UPLOAD_LOG_REPORT_FOOTNOTE,
  UPLOAD_LOG_STAGES,
  type UploadLogReport,
} from '@/lib/uploadLogReport';

const STAGE_COL_WIDTH = 14;
const PENDING_COL_WIDTH = 14;
const PROCESSED_USER_INDENT = 2;

function padEndVis(value: string, width: number): string {
  const chars = Array.from(value);
  if (chars.length >= width) return value;
  return value + ' '.repeat(width - chars.length);
}

function padStartVis(value: string, width: number): string {
  const chars = Array.from(value);
  if (chars.length >= width) return value;
  return ' '.repeat(width - chars.length) + value;
}

function visualLength(value: string): number {
  return Array.from(value).length;
}

function maxUserNameWidthForDay(report: UploadLogReport, hkDate: string): number {
  const row = report.dailyRows.find((r) => r.hkDate === hkDate);
  if (!row) return 12;

  let max = 0;
  for (const stage of UPLOAD_LOG_STAGES) {
    for (const user of row.stages[stage].users) {
      max = Math.max(max, visualLength(user.userName));
    }
  }
  return Math.max(max, 12);
}

function formatProcessedBlock(
  completedCount: number,
  users: { userName: string; count: number }[],
  isToday: boolean,
  userNameWidth: number,
): string[] {
  const label = isToday ? '今日已處理' : '當日已處理';
  const lines = [`${label} ${completedCount} 件`];
  for (const user of users) {
    const namePart = padEndVis(user.userName, userNameWidth);
    const countPart = padStartVis(`${user.count} 件`, 6);
    lines.push(`${' '.repeat(PROCESSED_USER_INDENT)}${namePart}${countPart}`);
  }
  return lines;
}

function formatDaySection(report: UploadLogReport, hkDate: string): string[] {
  const row = report.dailyRows.find((r) => r.hkDate === hkDate);
  if (!row) return [`${formatHkDateLabel(hkDate, report.todayHk)}`, '（尚無紀錄）', ''];

  const isToday = hkDate === report.todayHk;
  const userNameWidth = maxUserNameWidthForDay(report, hkDate);
  const lines: string[] = [
    formatHkDateLabel(hkDate, report.todayHk),
    '',
    `${padEndVis('階段', STAGE_COL_WIDTH)}${padEndVis('產品目前停留', PENDING_COL_WIDTH)}今日已處理`,
    '-'.repeat(56),
  ];

  for (const stage of UPLOAD_LOG_STAGES) {
    const stats = row.stages[stage];
    const pending = isToday ? `${report.pendingCounts[stage]} 件` : '—';
    const processed = formatProcessedBlock(stats.completedCount, stats.users, isToday, userNameWidth);
    lines.push(
      `${padEndVis(STAGE_LABELS[stage], STAGE_COL_WIDTH)}${padEndVis(pending, PENDING_COL_WIDTH)}${processed[0]}`,
    );
    for (let i = 1; i < processed.length; i++) {
      lines.push(`${' '.repeat(STAGE_COL_WIDTH + PENDING_COL_WIDTH)}${processed[i]}`);
    }
  }

  lines.push('');
  return lines;
}

export interface FormatUploadLogReportTextOptions {
  /** Which dates to include. Default: all dailyRows (same as 全部日期 view). */
  dates?: string[];
  /** If set, only include this single date. */
  singleDate?: string;
}

/** Plain-text report preserving page table layout for email / messaging. */
export function formatUploadLogReportAsText(
  report: UploadLogReport,
  options: FormatUploadLogReportTextOptions = {},
): string {
  const generatedLabel = formatHkDateTime(new Date(report.generatedAt));
  const dates = options.singleDate
    ? [options.singleDate]
    : options.dates ?? report.dailyRows.map((r) => r.hkDate);

  const lines: string[] = [
    '上載產品紀錄',
    `最近 30 日 · 香港時間 ${formatHkDateTime()}`,
    `資料更新於 ${generatedLabel}（香港時間）`,
    '',
  ];

  for (const hkDate of dates) {
    lines.push(...formatDaySection(report, hkDate));
  }

  lines.push(
    '—',
    UPLOAD_LOG_REPORT_FOOTNOTE,
  );

  return lines.join('\n');
}

export function formatTodayUploadLogReportAsText(report: UploadLogReport): string {
  return formatUploadLogReportAsText(report, { singleDate: report.todayHk });
}

export type { UploadLogStage };
