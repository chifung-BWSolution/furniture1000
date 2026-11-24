/**
 * Daily supplier catalog / quotation parse progress aggregation + BW Furniture branded email renderer.
 */

import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
  renderDetailBox,
} from "./brandedEmail.ts";
import { escapeHtml } from "./escapeHtml.ts";
import { formatInternalEmailSubject } from "./internalEmailSubject.ts";

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DigestDocumentInput {
  id: string;
  factory_name: string;
  doc_type: string;
  title: string | null;
  source: string | null;
  status: string;
  file_size: number | null;
  page_count: number | null;
  part_count?: number | null;
  parts_done?: number | null;
  error_message: string | null;
  created_at: string;
  modified_date: string;
  itemCount: number;
}

export interface DigestAsanaSyncInput {
  status: string;
  skip_reason: string | null;
  doc_type: string;
  file_name: string;
  error_message: string | null;
}

export interface DigestDocumentRow extends DigestDocumentInput {
  inWindow: boolean;
}

export interface DocumentParseDigestSummary {
  reportDate: string;
  windowStartLabel: string;
  windowEndLabel: string;
  rangeStartIso: string;
  rangeEndIso: string;
  totalDocs: number;
  inWindowCount: number;
  completedCount: number;
  failedCount: number;
  parsingCount: number;
  catalogCount: number;
  quoteCount: number;
  totalExtractedItems: number;
  asanaSynced: number;
  asanaSkipped: number;
  asanaFailed: number;
  hasActivity: boolean;
  documents: DigestDocumentRow[];
  failedDocuments: DigestDocumentRow[];
}

export interface DocumentParseDigestEmail {
  subject: string;
  html: string;
  text: string;
}

function formatUtcDateYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatHkDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms + HK_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * Compute yesterday 09:00 HKT .. reportDate 09:00 HKT (exclusive).
 * Defaults `reportDate` to today in Asia/Shanghai (UTC+8).
 */
export function getDailyParseDigestRangeHk(options?: {
  now?: Date;
  reportDate?: string;
}): {
  reportDate: string;
  windowStartLabel: string;
  windowEndLabel: string;
  rangeStartIso: string;
  rangeEndIso: string;
} {
  let reportDate: string;
  if (options?.reportDate) {
    const trimmed = options.reportDate.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid report_date format (expected YYYY-MM-DD): ${trimmed}`);
    }
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const testMs = Date.UTC(y, m - 1, d);
    const check = new Date(testMs);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      throw new Error(`Invalid calendar date: ${trimmed}`);
    }
    reportDate = trimmed;
  } else {
    const now = options?.now ?? new Date();
    reportDate = formatUtcDateYmd(now.getTime() + HK_OFFSET_MS);
  }

  const [y, m, d] = reportDate.split("-").map(Number);
  const endHkMidnightUtcMs = Date.UTC(y, m - 1, d) - HK_OFFSET_MS;
  // 09:00 HKT = 01:00 UTC
  const rangeEndMs = endHkMidnightUtcMs + 9 * 60 * 60 * 1000;
  const rangeStartMs = rangeEndMs - DAY_MS;
  const startDate = formatUtcDateYmd(rangeStartMs + HK_OFFSET_MS);

  return {
    reportDate,
    windowStartLabel: `${startDate} 09:00`,
    windowEndLabel: `${reportDate} 09:00`,
    rangeStartIso: new Date(rangeStartMs).toISOString(),
    rangeEndIso: new Date(rangeEndMs).toISOString(),
  };
}

function inRange(iso: string | null | undefined, startMs: number, endMs: number): boolean {
  if (!iso) return false;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) && ms >= startMs && ms < endMs;
}

function docStatusOrder(status: string): number {
  switch (status) {
    case "failed":
      return 0;
    case "parsing":
    case "uploaded":
      return 1;
    case "review":
      return 2;
    case "ready":
      return 3;
    default:
      return 4;
  }
}

export function aggregateDocumentParseDigest(
  docs: DigestDocumentInput[],
  asanaSyncRows: DigestAsanaSyncInput[],
  range: {
    reportDate: string;
    windowStartLabel: string;
    windowEndLabel: string;
    rangeStartIso: string;
    rangeEndIso: string;
  },
): DocumentParseDigestSummary {
  const startMs = Date.parse(range.rangeStartIso);
  const endMs = Date.parse(range.rangeEndIso);

  const byId = new Map<string, DigestDocumentRow>();
  for (const doc of docs) {
    const touchedInWindow =
      inRange(doc.created_at, startMs, endMs) || inRange(doc.modified_date, startMs, endMs);
    const outstanding = doc.status === "failed" || doc.status === "parsing" || doc.status === "uploaded";
    if (!touchedInWindow && !outstanding) continue;
    const prev = byId.get(doc.id);
    if (!prev || touchedInWindow) {
      byId.set(doc.id, { ...doc, inWindow: touchedInWindow });
    }
  }

  const documents = [...byId.values()].sort((a, b) => {
    const sDiff = docStatusOrder(a.status) - docStatusOrder(b.status);
    if (sDiff !== 0) return sDiff;
    return Date.parse(b.modified_date || b.created_at) - Date.parse(a.modified_date || a.created_at);
  });

  const failedDocuments = documents.filter((d) => d.status === "failed");
  const inWindowCount = documents.filter((d) => d.inWindow).length;
  const completedCount = documents.filter((d) => d.status === "review" || d.status === "ready").length;
  const failedCount = failedDocuments.length;
  const parsingCount = documents.filter((d) => d.status === "parsing" || d.status === "uploaded").length;
  const catalogCount = documents.filter((d) => d.doc_type === "catalog").length;
  const quoteCount = documents.filter((d) => d.doc_type === "quote" || d.doc_type === "price_list").length;
  const totalExtractedItems = documents.reduce((sum, d) => sum + (Number(d.itemCount) || 0), 0);

  let asanaSynced = 0;
  let asanaSkipped = 0;
  let asanaFailed = 0;
  for (const row of asanaSyncRows) {
    if (row.status === "synced") asanaSynced += 1;
    else if (row.status === "skipped") asanaSkipped += 1;
    else if (row.status === "failed") asanaFailed += 1;
  }

  const hasActivity =
    inWindowCount > 0 ||
    failedCount > 0 ||
    parsingCount > 0 ||
    asanaSynced > 0 ||
    asanaSkipped > 0 ||
    asanaFailed > 0;

  return {
    ...range,
    totalDocs: documents.length,
    inWindowCount,
    completedCount,
    failedCount,
    parsingCount,
    catalogCount,
    quoteCount,
    totalExtractedItems,
    asanaSynced,
    asanaSkipped,
    asanaFailed,
    hasActivity,
    documents,
    failedDocuments,
  };
}

function docTypeLabel(docType: string): string {
  switch (docType) {
    case "catalog":
      return "圖冊";
    case "certificate":
      return "證書";
    default:
      return "報價單";
  }
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case "asana":
      return "Asana 同步";
    case "ai_processor":
      return "AI 處理";
    default:
      return "手動上載";
  }
}

function statusBadgeMeta(doc: DigestDocumentRow): { label: string; bg: string; border: string; color: string } {
  switch (doc.status) {
    case "review":
      return { label: "待審核", bg: "#ECFDF5", border: "#A7F3D0", color: "#065F46" };
    case "ready":
      return { label: "已完成", bg: "#EFF6FF", border: "#BFDBFE", color: "#1E40AF" };
    case "failed":
      return { label: "解析失敗", bg: "#FEF2F2", border: "#FECACA", color: "#991B1B" };
    case "parsing":
      return {
        label: doc.part_count ? `解析中 (${doc.parts_done ?? 0}/${doc.part_count})` : "解析中",
        bg: "#F0F9FF",
        border: "#BAE6FD",
        color: "#0369A1",
      };
    default:
      return { label: "已上載", bg: "#F8FAFC", border: "#E2E8F0", color: "#475569" };
  }
}

function formatSizeMb(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderFailedSectionHtml(failedDocs: DigestDocumentRow[]): string {
  if (failedDocs.length === 0) {
    return `<div style="margin-top:26px;padding:15px 18px;border-radius:12px;background-color:#ECFDF5;border:1px solid #A7F3D0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.65;color:#065F46;">
      <strong>異常檢查：</strong>本輪沒有解析失敗的圖冊或報價單。
    </div>`;
  }

  const rowsHtml = failedDocs
    .map(
      (doc) => `<tr>
        <td valign="top" style="padding:11px 10px;border-top:1px solid #FECACA;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:1.5;color:#0F1B3D;">
          <div style="font-weight:700;">${escapeHtml(doc.factory_name || "未指定廠家")}</div>
          <div style="color:#475569;word-break:break-word;">${escapeHtml(doc.title || "未命名文件")}</div>
        </td>
        <td valign="top" style="padding:11px 8px;border-top:1px solid #FECACA;font-family:${EMAIL_FONT_STACK};font-size:12.5px;color:#7F1D1D;white-space:nowrap;">${escapeHtml(docTypeLabel(doc.doc_type))}</td>
        <td valign="top" style="padding:11px 8px;border-top:1px solid #FECACA;font-family:${EMAIL_FONT_STACK};font-size:12.5px;color:#7F1D1D;white-space:nowrap;">${escapeHtml(formatSizeMb(doc.file_size))}${doc.page_count ? ` / ${doc.page_count} 頁` : ""}</td>
        <td valign="top" style="padding:11px 10px;border-top:1px solid #FECACA;font-family:${EMAIL_FONT_STACK};font-size:12.5px;line-height:1.55;color:#991B1B;word-break:break-word;">${escapeHtml(doc.error_message || "未知錯誤")}</td>
      </tr>`,
    )
    .join("");

  return `<div style="margin-top:26px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:15.5px;font-weight:700;color:#991B1B;margin-bottom:10px;">
      需關注：解析失敗文件（共 ${failedDocs.length} 份，原檔仍在系統可於「AI 提取審核」重跑）
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#FEF2F2;border:1px solid #FECACA;border-radius:12px;border-collapse:separate;">
      <thead>
        <tr>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#991B1B;">廠家 / 文件</th>
          <th align="left" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#991B1B;white-space:nowrap;">類型</th>
          <th align="left" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#991B1B;white-space:nowrap;">大小 / 頁數</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#991B1B;">失敗原因</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

function renderAllDocumentsSectionHtml(documents: DigestDocumentRow[]): string {
  if (documents.length === 0) {
    return `<div style="margin-top:26px;padding:18px 20px;border-radius:12px;background-color:#F8FAFC;border:1px solid #E2E8F0;font-family:${EMAIL_FONT_STACK};font-size:14px;color:#64748B;text-align:center;">
      本統計區間尚無圖冊或報價單解析紀錄。
    </div>`;
  }

  const rowsHtml = documents
    .map((doc) => {
      const badge = statusBadgeMeta(doc);
      const sizePages = `${formatSizeMb(doc.file_size)}${doc.page_count ? ` · ${doc.page_count} 頁` : ""}`;
      const noteText = doc.error_message
        ? doc.error_message
        : doc.inWindow
          ? formatHkDateTime(doc.modified_date || doc.created_at)
          : `遺留待處理（${formatHkDateTime(doc.created_at)}）`;
      return `<tr>
        <td valign="top" style="padding:10px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:13px;line-height:1.5;">
          <div style="font-weight:600;color:#0F1B3D;">${escapeHtml(doc.factory_name || "未指定廠家")}</div>
          <div style="color:#475569;word-break:break-word;">${escapeHtml(doc.title || "未命名文件")}</div>
          <div style="font-size:11.5px;color:#94A3B8;">${escapeHtml(sourceLabel(doc.source))} · ${escapeHtml(sizePages)}</div>
        </td>
        <td valign="top" style="padding:10px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12.5px;color:#334155;white-space:nowrap;">${escapeHtml(docTypeLabel(doc.doc_type))}</td>
        <td valign="top" style="padding:10px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12px;white-space:nowrap;">
          <span style="display:inline-block;padding:2px 8px;border-radius:999px;background-color:${badge.bg};border:1px solid ${badge.border};color:${badge.color};font-weight:600;">${escapeHtml(badge.label)}</span>
        </td>
        <td valign="top" align="right" style="padding:10px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:13px;font-weight:600;color:#0F1B3D;white-space:nowrap;">${doc.itemCount}</td>
        <td valign="top" style="padding:10px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12px;color:${doc.error_message ? "#991B1B" : "#64748B"};word-break:break-word;">${escapeHtml(noteText)}</td>
      </tr>`;
    })
    .join("");

  return `<div style="margin-top:28px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:15.5px;font-weight:700;color:#0E1B3A;margin-bottom:10px;">
      文件處理明細（共 ${documents.length} 份）
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#FFFFFF;border:1px solid #E5EAF3;border-radius:12px;border-collapse:separate;">
      <thead>
        <tr style="background-color:#F5F9FF;">
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;">廠家 / 文件</th>
          <th align="left" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">類型</th>
          <th align="left" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">狀態</th>
          <th align="right" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">提取數</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;">更新時間 / 備註</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

export function buildDocumentParseDigestEmail(
  summary: DocumentParseDigestSummary,
  options?: { isTest?: boolean; portalUrl?: string },
): DocumentParseDigestEmail {
  const periodLabel = `${summary.windowStartLabel} 至 ${summary.windowEndLabel}（HKT）`;
  const statusSuffix = summary.failedCount > 0
    ? `｜完成 ${summary.completedCount} · 失敗 ${summary.failedCount}`
    : `｜完成 ${summary.completedCount}`;
  const subject = formatInternalEmailSubject(
    `圖冊／報價單夜間解析進度報告（${summary.reportDate}）${statusSuffix}`,
    { tag: "圖冊解析", isTest: options?.isTest },
  );

  const preheader = `統計區間 ${periodLabel}：共 ${summary.totalDocs} 份文件（圖冊 ${summary.catalogCount}、報價單 ${summary.quoteCount}），完成 ${summary.completedCount} 份、失敗 ${summary.failedCount} 份，提取 ${summary.totalExtractedItems} 項產品。`;
  const heading = "圖冊／報價單夜間解析進度報告";
  const subheading = `統計區間：${periodLabel}`;

  const detailRows = [
    { label: "統計區間", value: periodLabel },
    {
      label: "處理文件",
      value: `共 ${summary.totalDocs} 份（圖冊 ${summary.catalogCount} 份 ／ 報價單 ${summary.quoteCount} 份）`,
    },
    {
      label: "解析結果",
      value: `完成待審 ${summary.completedCount} 份 ／ 失敗 ${summary.failedCount} 份 ／ 進行中 ${summary.parsingCount} 份`,
    },
    {
      label: "提取產品",
      value: `${summary.totalExtractedItems} 項`,
    },
  ];
  if (summary.asanaSynced + summary.asanaSkipped + summary.asanaFailed > 0) {
    detailRows.push({
      label: "Asana 同步",
      value: `入庫 ${summary.asanaSynced} 份 ／ 跳過 ${summary.asanaSkipped} 份 ／ 失敗 ${summary.asanaFailed} 份`,
    });
  }

  const portalUrl = options?.portalUrl?.trim() || "https://www.bwteam-furniture.com/fds/ai-processor/review";
  const contentHtml = `${renderDetailBox(detailRows)}
    ${renderFailedSectionHtml(summary.failedDocuments)}
    ${renderAllDocumentsSectionHtml(summary.documents)}
    ${renderCtaButton("前往 AI 提取審核", portalUrl)}`;

  const noteHtml =
    "夜間解析視窗為每日 23:00–翌日 09:00（HKT），此報告於 09:15 HKT 自動發送。解析失敗的圖冊仍可於報價單「圖冊附件」選擇或於 AI 提取審核重新解析。";

  const html = renderBrandedEmail({
    locale: "zh-Hant",
    preheader,
    heading,
    subheading,
    contentHtml,
    noteHtml,
  });

  const textLines: string[] = [
    heading,
    `統計區間：${periodLabel}`,
    "",
    `處理文件：共 ${summary.totalDocs} 份（圖冊 ${summary.catalogCount} 份／報價單 ${summary.quoteCount} 份）`,
    `解析結果：完成待審 ${summary.completedCount} 份／失敗 ${summary.failedCount} 份／進行中 ${summary.parsingCount} 份`,
    `提取產品：${summary.totalExtractedItems} 項`,
  ];
  if (summary.asanaSynced + summary.asanaSkipped + summary.asanaFailed > 0) {
    textLines.push(
      `Asana 同步：入庫 ${summary.asanaSynced} 份／跳過 ${summary.asanaSkipped} 份／失敗 ${summary.asanaFailed} 份`,
    );
  }

  if (summary.failedDocuments.length > 0) {
    textLines.push("", "--- 需關注：解析失敗文件 ---");
    for (const doc of summary.failedDocuments) {
      textLines.push(
        `- ${doc.factory_name}｜${doc.title || "未命名文件"}（${docTypeLabel(doc.doc_type)}，${formatSizeMb(doc.file_size)}）｜原因：${doc.error_message || "未知錯誤"}`,
      );
    }
  }

  textLines.push("", "--- 文件處理明細 ---");
  if (summary.documents.length === 0) {
    textLines.push("本統計區間尚無圖冊或報價單解析紀錄。");
  } else {
    for (const doc of summary.documents) {
      const badge = statusBadgeMeta(doc);
      textLines.push(
        `- [${badge.label}] ${doc.factory_name}｜${doc.title || "未命名文件"}（${docTypeLabel(doc.doc_type)}，${sourceLabel(doc.source)}，${formatSizeMb(doc.file_size)}）｜提取 ${doc.itemCount} 項${doc.error_message ? `｜原因：${doc.error_message}` : ""}`,
      );
    }
  }

  textLines.push("", `前往 AI 提取審核：${portalUrl}`, "", noteHtml, "", companyFooterText("zh-Hant"));

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}
