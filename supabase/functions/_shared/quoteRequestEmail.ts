/**
 * FDS-14 "customer submitted a quote selection" notification sent to the quote owner.
 */

import { escapeHtml } from "./email.ts";
import {
  breakableQuoteId,
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
  renderDetailBox,
} from "./brandedEmail.ts";

export interface QuoteRequestLine {
  name?: string;
  quantity?: number;
  selected?: boolean;
  unit?: string;
  note?: string;
}

export interface QuoteRequestEmailInput {
  quoteId: string;
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

export function buildQuoteRequestEmail(input: QuoteRequestEmailInput): BuiltEmail {
  const quoteId = String(input.quoteId ?? "").trim() || "未命名報價";
  const note = String(input.note ?? "").trim();
  const pmName = String(input.pmName ?? "").trim();
  const quoteUrl = String(input.quoteUrl ?? "").trim();
  const rows = selectedLines(input);
  const total = money(input.totalCents);
  const subject = `客戶提交報價選擇：${quoteId}`;

  const linesText = rows.length
    ? rows.map((line) => `- ${line.name || "未命名項目"} × ${line.quantity}${line.unit ? ` ${line.unit}` : ""}${line.note ? `（${line.note}）` : ""}`).join("\n")
    : "- 客戶沒有勾選項目，只留下需求說明。";

  const text = [
    "客戶已在報價頁面提交選擇，請確認後處理正式報價。",
    "",
    `報價單 ${quoteId} 收到客戶提交。`,
    "",
    "客戶選擇：",
    linesText,
    "",
    `選品合計（只作參考，不是正式報價金額）：${total}`,
    note ? `客戶需求：${note}` : "",
    pmName ? `負責同事：${pmName}` : "",
    quoteUrl ? `開啟報價：${quoteUrl}` : "",
    "",
    "客戶提交不會改寫正式報價的單價、明細或總額；請確認後另行處理正式報價。",
    "此為系統自動發送的通知郵件，請勿回覆。",
    "",
    companyFooterText(),
  ].filter((line) => line !== "").join("\n");

  const linesHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
        ${rows.map((line) => `<tr>
          <td style="padding:11px 0;border-bottom:1px solid #EDF1F7;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#1D2939;">${escapeHtml(line.name || "未命名項目")}${line.note ? `<div style="font-size:13px;line-height:1.6;color:#7C8AA3;padding-top:3px;">${escapeHtml(line.note)}</div>` : ""}</td>
          <td align="right" valign="top" style="padding:11px 0 11px 16px;border-bottom:1px solid #EDF1F7;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#0F1B3D;font-weight:600;white-space:nowrap;">× ${escapeHtml(String(line.quantity ?? ""))}${line.unit ? ` ${escapeHtml(line.unit)}` : ""}</td>
        </tr>`).join("")}
      </table>`
    : `<p style="margin:0;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.8;color:#5B6880;">客戶沒有勾選項目，只留下需求說明。</p>`;

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    <p style="margin:0;">報價單 <span style="color:#0E1B3A;font-weight:600;word-break:normal;overflow-wrap:anywhere;">${breakableQuoteId(quoteId)}</span> 收到客戶提交。</p>
  </div>

  ${renderDetailBox([
    { label: "報價編號", value: quoteId, breakable: true },
    { label: "選品合計", value: `${total}（只作參考）` },
  ])}

  <div style="margin-top:26px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:#0F1B3D;padding-bottom:8px;">客戶選擇</div>
    ${linesHtml}
  </div>

  ${note ? `<div style="margin-top:22px;padding:16px 18px;background-color:#F8FAFD;border:1px solid #E9EDF5;border-radius:10px;font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.8;color:#1D2939;"><strong style="color:#0F1B3D;">客戶需求：</strong>${escapeHtml(note)}</div>` : ""}

  ${pmName ? `<p style="margin:18px 0 0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.7;color:#5B6880;">負責同事：${escapeHtml(pmName)}</p>` : ""}

  ${quoteUrl ? renderCtaButton("開啟報價", quoteUrl) : ""}`;

  const html = renderBrandedEmail({
    preheader: "客戶已在報價頁面提交選擇，請確認後處理正式報價。",
    heading: "客戶已提交報價選擇",
    subheading: "客戶已在報價頁面提交選擇，請確認後處理正式報價。",
    contentHtml,
    noteHtml: "客戶提交不會改寫正式報價的單價、明細或總額；請確認後另行處理正式報價。<br>此為系統自動發送的通知郵件，請勿回覆。",
  });

  return { subject, text, html };
}
