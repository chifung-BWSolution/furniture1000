import {
  formatHkDateLabel,
  formatHkDateTime,
  STAGE_LABELS,
  UPLOAD_LOG_STAGES,
  type UploadLogReport,
} from '@/lib/uploadLogReport';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatProcessedCellHtml(
  completedCount: number,
  users: { userName: string; count: number }[],
  isToday: boolean,
): string {
  const label = isToday ? '今日已處理' : '當日已處理';
  const header = `<div style="font-size:13px;color:#111827;line-height:1.5;">${label} <strong style="color:#2563eb;font-weight:700;">${completedCount}</strong> 件</div>`;

  if (users.length === 0) return header;

  const userRows = users
    .map(
      (user) => `
    <tr>
      <td style="font-size:12px;color:#6b7280;padding:3px 12px 3px 0;vertical-align:top;">${escapeHtml(user.userName)}</td>
      <td style="font-size:12px;color:#6b7280;padding:3px 0;vertical-align:top;text-align:right;white-space:nowrap;width:56px;">${user.count} 件</td>
    </tr>`,
    )
    .join('');

  return `${header}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;border-top:1px solid #e5e7eb;">
      <tbody>${userRows}</tbody>
    </table>`;
}

function formatDaySectionHtml(report: UploadLogReport, hkDate: string): string {
  const row = report.dailyRows.find((r) => r.hkDate === hkDate);
  if (!row) {
    return `<h3 style="margin:24px 0 8px;font-size:16px;color:#111827;">${escapeHtml(formatHkDateLabel(hkDate, report.todayHk))}</h3><p style="color:#6b7280;">（尚無紀錄）</p>`;
  }

  const isToday = hkDate === report.todayHk;
  const stageRows = UPLOAD_LOG_STAGES.map((stage) => {
    const stats = row.stages[stage];
    const pending = isToday ? `${report.pendingCounts[stage]} 件` : '—';
    return `
      <tr>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;font-weight:700;color:#111827;vertical-align:top;width:148px;">${escapeHtml(STAGE_LABELS[stage])}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111827;vertical-align:top;width:120px;white-space:nowrap;">${escapeHtml(pending)}</td>
        <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${formatProcessedCellHtml(stats.completedCount, stats.users, isToday)}</td>
      </tr>`;
  }).join('');

  return `
    <h3 style="margin:24px 0 12px;font-size:16px;color:#111827;">${escapeHtml(formatHkDateLabel(hkDate, report.todayHk))}</h3>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e5e7eb;border-radius:12px;border-collapse:separate;overflow:hidden;">
      <thead>
        <tr style="background:#f3f4f6;">
          <th align="left" style="padding:12px 16px;font-size:13px;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb;width:148px;">階段</th>
          <th align="left" style="padding:12px 16px;font-size:13px;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb;width:120px;">產品目前停留</th>
          <th align="left" style="padding:12px 16px;font-size:13px;font-weight:700;color:#111827;border-bottom:1px solid #e5e7eb;">今日已處理</th>
        </tr>
      </thead>
      <tbody>${stageRows}</tbody>
    </table>`;
}

export interface FormatUploadLogReportHtmlOptions {
  dates?: string[];
  singleDate?: string;
}

export function formatUploadLogReportAsHtml(
  report: UploadLogReport,
  options: FormatUploadLogReportHtmlOptions = {},
): string {
  const generatedLabel = formatHkDateTime(new Date(report.generatedAt));
  const dates = options.singleDate
    ? [options.singleDate]
    : options.dates ?? report.dailyRows.map((r) => r.hkDate);

  const daySections = dates.map((hkDate) => formatDaySectionHtml(report, hkDate)).join('');

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>上載產品紀錄</title>
</head>
<body style="margin:0;padding:20px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;line-height:1.5;">
  <div style="max-width:760px;margin:0 auto;">
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">上載產品紀錄</h2>
    <p style="margin:0 0 4px;font-size:13px;color:#6b7280;">最近 30 日 · 香港時間 ${escapeHtml(formatHkDateTime())}</p>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280;">資料更新於 ${escapeHtml(generatedLabel)}（香港時間）</p>
    ${daySections}
    <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">「產品目前停留」僅顯示今天；「今日已處理」：產品文案 upload_log + copy_done_at；產品信息 upload_log（完成）+ ready_to_shopify。</p>
  </div>
</body>
</html>`;
}

export function formatTodayUploadLogReportAsHtml(report: UploadLogReport): string {
  return formatUploadLogReportAsHtml(report, { singleDate: report.todayHk });
}
