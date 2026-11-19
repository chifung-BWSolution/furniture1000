/**
 * FDS-14 "customer viewed the quotation" notification sent to the quote owner.
 */

import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
  renderDetailBox,
} from "./brandedEmail.ts";
import { escapeHtml } from "./escapeHtml.ts";
import { pmNoticeGreeting, pmNoticeTitle } from "./quotePmNotice.ts";

export interface QuoteViewEmailInput {
  /** Quotation number shown in the subject and detail table. */
  quoteId: string;
  /** Raw `viewed_at` timestamp from `bwf_quote_share_view`. */
  viewedAtIso: string;
  /** Quote owner. The subject and greeting use this name. */
  pmName?: string | null;
  /** Staff quote editor. Omitted when the app URL is not configured. */
  quoteUrl?: string | null;
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

const VIEW_ACTION = "客戶已查看報價";
const VIEW_BODY = "客戶已開啟這張報價。系統已停止這張報價的進度提醒，其他報價不受影響。";

export function buildQuoteViewEmail(input: QuoteViewEmailInput): BuiltEmail {
  const quoteId = String(input.quoteId ?? "").trim() || "未命名報價";
  const viewedAt = formatHongKongTime(String(input.viewedAtIso ?? ""));
  const quoteUrl = String(input.quoteUrl ?? "").trim();
  const greeting = pmNoticeGreeting(input.pmName);
  const title = pmNoticeTitle(input.pmName, quoteId, VIEW_ACTION);

  const text = [
    greeting,
    "",
    VIEW_BODY,
    "",
    `報價編號：${quoteId}`,
    `查看時間：${viewedAt}`,
    "查看方式：客戶開啟報價頁面",
    ...(quoteUrl ? ["", `開啟報價：${quoteUrl}`] : []),
    "",
    "這是系統通知，請勿回覆。",
    "如需跟進，請直接聯絡客戶。",
    "",
    companyFooterText(),
  ].join("\n");

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    <p style="margin:0 0 16px;font-weight:600;color:#0E1B3A;">${escapeHtml(greeting)}</p>
    <p style="margin:0;">${VIEW_BODY}</p>
  </div>

  ${renderDetailBox([
    { label: "報價編號", value: quoteId, breakable: true },
    { label: "查看時間", value: viewedAt },
    { label: "查看方式", value: "客戶開啟報價頁面" },
  ])}

  ${quoteUrl ? renderCtaButton("開啟報價", quoteUrl) : ""}`;

  const html = renderBrandedEmail({
    preheader: VIEW_BODY,
    heading: title,
    contentHtml,
    noteHtml: "這是系統通知，請勿回覆。<br>如需跟進，請直接聯絡客戶。",
  });

  return { subject: title, text, html };
}
