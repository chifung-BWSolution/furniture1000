/**
 * FDS-14 "customer submitted a quote selection" notification sent to the quote owner.
 */

import { escapeHtml } from "./email.ts";
import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
  renderDetailBox,
} from "./brandedEmail.ts";
import { pmNoticeGreeting, pmNoticeTitle } from "./quotePmNotice.ts";

export interface QuoteRequestLine {
  name?: string;
  quantity?: number;
  selected?: boolean;
  unit?: string;
  note?: string;
  kind?: "original" | "addition" | "replacement";
  originalName?: string;
}

export interface QuoteRequestEmailInput {
  quoteId: string;
  /** 客戶動作：additional / replacement / change / confirm / reject / scheme… */
  requestType?: string | null;
  /** 客戶所看到的報價版本（v1、v2…）。 */
  quoteVersion?: string | null;
  lines: QuoteRequestLine[];
  note: string;
  totalCents: number;
  pmName?: string | null;
  quoteUrl?: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function money(cents: number): string {
  return `HK$ ${(Math.max(0, Number(cents) || 0) / 100).toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function selectedLines(input: QuoteRequestEmailInput): QuoteRequestLine[] {
  return (input.lines ?? []).filter((line) => line.selected !== false && Number(line.quantity) > 0);
}

const REQUEST_ACTION_LABELS: Record<string, string> = {
  scheme: "提交選品／數量",
  selection: "提交選品",
  quantity: "提交數量",
  additional: "加選家具",
  replacement: "更換款式",
  change: "提交加選／換款變更",
  confirm: "確認報價版本",
  reject: "不接受報價版本",
};

function actionLabel(requestType?: string | null): string {
  const key = String(requestType ?? "").trim();
  return REQUEST_ACTION_LABELS[key] ?? "提交報價選擇";
}

function lineText(line: QuoteRequestLine): string {
  const detail = `${line.name || "未命名項目"} × ${line.quantity}${line.unit ? ` ${line.unit}` : ""}${line.note ? `（${line.note}）` : ""}`;
  if (line.kind === "addition") return `[加選] ${detail}`;
  if (line.kind === "replacement") {
    return `[換款] ${line.originalName || "原報價項目"} → ${detail}`;
  }
  return detail;
}

export function buildQuoteRequestEmail(input: QuoteRequestEmailInput): BuiltEmail {
  const quoteId = String(input.quoteId ?? "").trim() || "未命名報價";
  const note = String(input.note ?? "").trim();
  const pmName = String(input.pmName ?? "").trim();
  const quoteUrl = String(input.quoteUrl ?? "").trim();
  const rows = selectedLines(input);
  const total = money(input.totalCents);
  const action = actionLabel(input.requestType);
  const isDecision = input.requestType === "confirm" || input.requestType === "reject";
  const version = String(input.quoteVersion ?? "").trim();
  const greeting = pmNoticeGreeting(pmName);
  const title = pmNoticeTitle(pmName, quoteId, `客戶${action}`, version);
  const lead = `客戶已在報價頁面${action}，請你確認後處理正式報價。這次提交不會改寫現有單價、明細或總額。`;

  const linesText = rows.length
    ? rows.map((line) => `- ${lineText(line)}`).join("\n")
    : isDecision
      ? "- 客戶已就這個報價版本作出決定。"
      : "- 客戶沒有勾選項目，只留下需求說明。";

  const text = [
    greeting,
    "",
    lead,
    "",
    "客戶提交內容：",
    linesText,
    "",
    rows.length > 0 ? `選品合計（參考）：${total}` : "",
    note ? `客戶需求：${note}` : "",
    quoteUrl ? `開啟報價：${quoteUrl}` : "",
    "",
    "這是系統通知，請勿回覆。",
    "",
    companyFooterText(),
  ].filter((line) => line !== "").join("\n");

  const linesHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
        ${rows.map((line) => {
          const badge = line.kind === "addition"
            ? `<span style="display:inline-block;margin-right:6px;padding:1px 6px;border-radius:4px;background:#0C4A6E;color:#fff;font-size:11px;font-weight:700;">加選</span>`
            : line.kind === "replacement"
              ? `<span style="display:inline-block;margin-right:6px;padding:1px 6px;border-radius:4px;background:#B45309;color:#fff;font-size:11px;font-weight:700;">換款</span>`
              : "";
          const original = line.kind === "replacement"
            ? `<div style="font-size:13px;line-height:1.6;color:#7C8AA3;">原項目：${escapeHtml(line.originalName || "原報價項目")}</div>`
            : "";
          return `<tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDF1F7;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#1D2939;">${badge}${escapeHtml(line.name || "未命名項目")}${original}${line.note ? `<div style="font-size:13px;line-height:1.6;color:#7C8AA3;padding-top:3px;">${escapeHtml(line.note)}</div>` : ""}</td>
          <td align="right" valign="top" style="padding:11px 0 11px 16px;border-bottom:1px solid #EDF1F7;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#0F1B3D;font-weight:600;white-space:nowrap;">× ${escapeHtml(String(line.quantity ?? ""))}${line.unit ? ` ${escapeHtml(line.unit)}` : ""}</td>
        </tr>`;
        }).join("")}
      </table>`
    : isDecision
      ? `<p style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.8;color:#5B6880;">客戶已就這個報價版本作出決定。</p>`
      : `<p style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.8;color:#5B6880;">客戶沒有勾選項目，只留下需求說明。</p>`;

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    <p style="margin:0 0 16px;font-weight:600;color:#0E1B3A;">${escapeHtml(greeting)}</p>
    <p style="margin:0;">${escapeHtml(lead)}</p>
  </div>

  ${renderDetailBox([
    { label: "報價編號", value: quoteId, breakable: true },
    { label: "客戶動作", value: action },
    ...(version ? [{ label: "報價版本", value: version }] : []),
    ...(input.totalCents > 0 ? [{ label: "選品合計（參考）", value: total }] : []),
  ])}

  <div style="margin-top:26px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:#0F1B3D;padding-bottom:8px;">客戶提交內容</div>
    ${linesHtml}
  </div>

  ${note ? `<div style="margin-top:22px;padding:16px 18px;background-color:#F8FAFD;border:1px solid #E9EDF5;border-radius:10px;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.8;color:#1D2939;"><strong style="color:#0F1B3D;">客戶需求：</strong>${escapeHtml(note)}</div>` : ""}

  ${quoteUrl ? renderCtaButton("開啟報價", quoteUrl) : ""}`;

  const html = renderBrandedEmail({
    preheader: lead,
    heading: title,
    contentHtml,
    noteHtml: "這是系統通知，請勿回覆。",
  });

  return { subject: title, text, html };
}
