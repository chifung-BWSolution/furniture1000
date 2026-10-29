/**
 * FDS-14 "customer viewed the quotation" notification sent to the quote owner.
 */

import {
  breakableQuoteId,
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderDetailBox,
} from "./brandedEmail.ts";

export interface QuoteViewEmailInput {
  /** Quotation number shown in the subject and detail table. */
  quoteId: string;
  /** Raw `viewed_at` timestamp from `bwf_quote_share_view`. */
  viewedAtIso: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** Quote notifications are always shown in Hong Kong time, matching the PM's day. */
export function formatHongKongTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")} (GMT+8)`;
}

export function buildQuoteViewEmail(input: QuoteViewEmailInput): BuiltEmail {
  const quoteId = String(input.quoteId ?? "").trim() || "未命名報價";
  const viewedAt = formatHongKongTime(String(input.viewedAtIso ?? ""));
  const subject = `客戶已查看報價：${quoteId}`;
  const subheading = "您的報價單已被客戶開啟，系統已自動停用該報價的進度提醒。";

  const text = [
    subheading,
    "",
    `報價單 ${quoteId} 已於以下時間被客戶查看，`,
    "我們已自動停止針對該報價的後續進度提醒，其他報價單的提醒設定不受影響。",
    "",
    `報價編號：${quoteId}`,
    `查看時間：${viewedAt}`,
    "查看方式：客戶開啟報價頁面",
    "",
    "此為系統自動發送的通知郵件，請勿回覆。",
    "如有任何疑問，請聯絡項目負責人或系統管理員。",
    "",
    companyFooterText(),
  ].join("\n");

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    報價單 <span style="color:#0E1B3A;font-weight:600;word-break:normal;overflow-wrap:anywhere;">${breakableQuoteId(quoteId)}</span> 已於以下時間被客戶查看，<br>
    我們已自動停止針對該報價的後續進度提醒，其他報價單的提醒設定不受影響。
  </div>

  ${renderDetailBox([
    { label: "報價編號", value: quoteId, breakable: true },
    { label: "查看時間", value: viewedAt },
    { label: "查看方式", value: "客戶開啟報價頁面" },
  ])}`;

  const html = renderBrandedEmail({
    preheader: subheading,
    heading: "客戶已查看報價",
    subheading,
    contentHtml,
    noteHtml: "此為系統自動發送的通知郵件，請勿回覆。<br>如有任何疑問，請聯絡項目負責人或系統管理員。",
  });

  return { subject, text, html };
}
