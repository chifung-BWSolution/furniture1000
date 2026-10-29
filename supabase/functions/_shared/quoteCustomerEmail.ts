/**
 * FDS-15 customer-facing quotation email (manual send and 3-day follow-up).
 *
 * The worker builds this from the quote template at send time, so the content
 * always reflects the latest intro/custom sections stored on the quote.
 */

import { escapeHtml } from "./email.ts";
import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
} from "./brandedEmail.ts";

export interface QuoteCustomerEmailInput {
  kind: "manual" | "follow_up";
  quoteId: string;
  introText?: string;
  contactPhone: string;
  customSections?: Array<{ title?: string; body?: string }>;
  itemCount: number;
  totalAmount: number;
  sampleItems?: string | null;
  shareUrl: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

function money(dollars: number): string {
  return `HK$ ${(Math.max(0, Number(dollars) || 0)).toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function customSections(input: QuoteCustomerEmailInput): Array<{ title: string; body: string }> {
  if (!Array.isArray(input.customSections)) return [];
  return input.customSections.flatMap((section) => {
    const title = String(section?.title ?? "").trim().slice(0, 60);
    const body = String(section?.body ?? "").trim().slice(0, 800);
    if (!title && !body) return [];
    return [{ title, body }];
  });
}

export function buildQuoteCustomerEmail(input: QuoteCustomerEmailInput): BuiltEmail {
  const isFollowUp = input.kind === "follow_up";
  const quoteId = String(input.quoteId ?? "").trim() || "傢俬方案";
  const intro = String(input.introText ?? "").trim();
  const phone = String(input.contactPhone ?? "").trim();
  const link = String(input.shareUrl ?? "").trim();
  const count = Math.max(0, Number(input.itemCount) || 0);
  const total = Math.max(0, Number(input.totalAmount) || 0);
  const sample = String(input.sampleItems ?? "").trim();
  const sections = customSections(input);

  const summaryParts: string[] = [];
  const summaryHtmlParts: string[] = [];
  if (count > 0) {
    summaryParts.push(`共 ${count} 項傢俬。`);
    summaryHtmlParts.push(`共 ${count} 項傢俬。`);
  }
  if (sample) {
    summaryParts.push(`包括：${sample}。`);
    summaryHtmlParts.push(`包括：${escapeHtml(sample)}。`);
  }
  if (total > 0) {
    const totalLabel = money(total);
    summaryParts.push(`參考總額 ${totalLabel}。`);
    summaryHtmlParts.push(`參考總額 <span style="white-space:nowrap;">${escapeHtml(totalLabel)}</span>。`);
  }
  if (summaryParts.length === 0) {
    summaryParts.push("報價內容請見下方連結。");
    summaryHtmlParts.push("報價內容請見下方連結。");
  }
  const summary = summaryParts.join(" ");
  const summaryHtml = summaryHtmlParts.join(" ");

  const subject = isFollowUp
    ? `跟進：${quoteId}（可隨時加單或改數量）`
    : `${quoteId} 報價及加單連結`;
  const heading = isFollowUp ? "跟進：您的傢俬方案" : "您的傢俬方案報價";
  const subheading = isFollowUp
    ? "報價已更新，您仍可加單、改數量或替換款式。"
    : "點擊下方按鈕查看報價、加單或調整數量。";
  const ctaLabel = isFollowUp ? "查看最新報價" : "查看報價及加單";
  const disclaimer = "此為系統發出的參考報價通知，正式報價以雙方確認的版本為準。";

  const text = [
    summary,
    intro,
    `如對方案有任何問題，可致電 ${phone} 與負責同事聯絡。`,
    link ? `需要加單、改數量或替換款式，請用這個連結提交：${link}` : "",
    ...sections.map((section) => [section.title, section.body].filter(Boolean).join("\n")),
    disclaimer,
    "",
    companyFooterText(),
  ].filter((line) => line !== "").join("\n\n");

  const sectionsHtml = sections.map((section) => `<div style="margin-top:26px;padding-top:20px;border-top:1px solid #E9EDF5;">
      ${section.title ? `<div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:#0F1B3D;margin-bottom:6px;">${escapeHtml(section.title)}</div>` : ""}
      <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.9;color:#1D2939;white-space:pre-wrap;">${escapeHtml(section.body)}</div>
    </div>`).join("");

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    <p style="margin:0 0 14px;">${summaryHtml}</p>
    ${intro ? `<p style="margin:0 0 14px;color:#5B6880;">${escapeHtml(intro)}</p>` : ""}
    <p style="margin:0 0 4px;">如對方案有任何問題，可致電 <strong style="color:#0F1B3D;white-space:nowrap;">${escapeHtml(phone)}</strong> 與負責同事聯絡。</p>
    <p style="margin:0;">需要加單、改數量或替換款式，請用下面的按鈕提交。</p>
    ${link ? renderCtaButton(ctaLabel, link) : ""}
    ${sectionsHtml}
  </div>`;

  const html = renderBrandedEmail({
    preheader: summary,
    heading,
    subheading,
    contentHtml,
    noteHtml: escapeHtml(disclaimer),
  });

  return { subject, text, html };
}
