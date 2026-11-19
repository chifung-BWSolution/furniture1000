import { renderQuoteEmailFooterHtml, type QuoteEmailFooterText } from "./quoteEmailFooter.ts";

/**
 * FDS-15 customer-facing quotation email (manual send and 3-day follow-up).
 *
 * The worker builds this from the quote template at send time, so the content
 * always reflects the latest intro/custom sections stored on the quote.
 */

import { escapeHtml } from "./escapeHtml.ts";
import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderCtaButton,
} from "./brandedEmail.ts";

export const QUOTE_EMAIL_LOCALES = {
  "zh-Hant": "繁體",
  "zh-Hans": "简体",
  en: "英文",
} as const;

export type QuoteEmailLocale = keyof typeof QUOTE_EMAIL_LOCALES;

export function normalizeQuoteEmailLocale(value: unknown): QuoteEmailLocale {
  return value === "zh-Hans" || value === "en" ? value : "zh-Hant";
}

const copyByLocale = {
  "zh-Hant": {
    quote: "傢俬方案",
    subject: (id: string) => id + " 報價及加單連結",
    followUpSubject: (id: string) => "跟進：" + id + "（可隨時加單或改數量）",
    heading: "您的傢俬方案報價",
    followUpHeading: "跟進：您的傢俬方案",
    subheading: "點擊下方按鈕查看報價、加單或調整數量。",
    followUpSubheading: "報價已更新，您仍可加單、改數量或替換款式。",
    count: (n: number) => "共 " + n + " 項傢俬。",
    sample: (items: string) => "包括：" + items + "。",
    total: (amount: string) => "參考總額 " + amount + "。",
    emptySummary: "報價內容請見下方連結。",
    instructions: "需要加單、改數量或替換款式，請用下面的按鈕提交。",
    cta: "網上查看報價及修改需求",
    disclaimer: "此為系統發出的參考報價通知，正式報價以雙方確認的版本為準。",
  },
  "zh-Hans": {
    quote: "家具方案",
    subject: (id: string) => id + " 报价及加单链接",
    followUpSubject: (id: string) => "跟进：" + id + "（可随时加单或改数量）",
    heading: "您的家具方案报价",
    followUpHeading: "跟进：您的家具方案",
    subheading: "点击下方按钮查看报价、加单或调整数量。",
    followUpSubheading: "报价已更新，您仍可加单、改数量或替换款式。",
    count: (n: number) => "共 " + n + " 项家具。",
    sample: (items: string) => "包括：" + items + "。",
    total: (amount: string) => "参考总额 " + amount + "。",
    emptySummary: "报价内容请见下方链接。",
    instructions: "需要加单、改数量或替换款式，请用下面的按钮提交。",
    cta: "网上查看报价及修改需求",
    disclaimer: "此为系统发出的参考报价通知，正式报价以双方确认的版本为准。",
  },
  en: {
    quote: "Furniture proposal",
    subject: (id: string) => id + " Furniture quotation",
    followUpSubject: (id: string) => "Follow-up: " + id + " Furniture quotation",
    heading: "Your furniture quotation",
    followUpHeading: "Following up on your furniture proposal",
    subheading: "Use the link below to view your quotation or request changes.",
    followUpSubheading: "You can still add items, change quantities, or request alternatives.",
    count: (n: number) => n + (n === 1 ? " furniture item." : " furniture items."),
    sample: (items: string) => "Includes: " + items + ".",
    total: (amount: string) => "Reference total: " + amount + ".",
    emptySummary: "See the link below for your quotation.",
    instructions: "Use the button below to add items, change quantities, or request alternatives.",
    cta: "View quotation and request changes online",
    disclaimer: "This automated quotation is for reference. The version confirmed by both parties takes precedence.",
  },
};

export interface QuoteCustomerEmailInput {
  kind: "manual" | "follow_up";
  quoteId: string;
  introText?: string;
  customerName?: string | null;
  locale?: string;
  footer?: QuoteEmailFooterText | null;
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
  const locale = normalizeQuoteEmailLocale(input.locale);
  const copy = copyByLocale[locale];
  const footer = input.footer?.[locale] ?? copy.disclaimer;
  const quoteId = String(input.quoteId ?? "").trim() || copy.quote;
  const intro = String(input.introText ?? "").trim();
  const customerName = String(input.customerName ?? "").trim().slice(0, 200);
  const greeting = customerName ? "Dear " + customerName + "," : "";
  const link = String(input.shareUrl ?? "").trim();
  const count = Math.max(0, Number(input.itemCount) || 0);
  const total = Math.max(0, Number(input.totalAmount) || 0);
  const sample = String(input.sampleItems ?? "").trim();
  const sections = customSections(input);

  const summaryParts: string[] = [];
  const summaryHtmlParts: string[] = [];
  if (count > 0) {
    summaryParts.push(copy.count(count));
    summaryHtmlParts.push(copy.count(count));
  }
  if (sample) {
    summaryParts.push(copy.sample(sample));
    summaryHtmlParts.push(copy.sample(escapeHtml(sample)));
  }
  if (total > 0) {
    const totalLabel = money(total);
    summaryParts.push(copy.total(totalLabel));
    summaryHtmlParts.push(copy.total(`<span style="white-space:nowrap;">${escapeHtml(totalLabel)}</span>`));
  }
  if (summaryParts.length === 0) {
    summaryParts.push(copy.emptySummary);
    summaryHtmlParts.push(copy.emptySummary);
  }
  const summary = summaryParts.join(" ");
  const summaryHtml = summaryHtmlParts.join(" ");

  const subject = isFollowUp ? copy.followUpSubject(quoteId) : copy.subject(quoteId);
  const heading = isFollowUp ? copy.followUpHeading : copy.heading;
  const subheading = isFollowUp ? copy.followUpSubheading : copy.subheading;

  const text = [
    greeting,
    summary,
    intro,
    link ? copy.instructions + " " + copy.cta + ": " + link : "",
    ...sections.map((section) => [section.title, section.body].filter(Boolean).join("\n")),
    footer,
    companyFooterText(locale),
  ].filter(Boolean).join("\n\n");

  const sectionsHtml = sections.map((section) => `<div style="margin-top:26px;padding-top:20px;border-top:1px solid #E9EDF5;">
      ${section.title ? `<div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:#0F1B3D;margin-bottom:6px;">${escapeHtml(section.title)}</div>` : ""}
      <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.9;color:#1D2939;white-space:pre-wrap;">${escapeHtml(section.body)}</div>
    </div>`).join("");

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
    ${greeting ? `<p style="margin:0 0 14px;">${escapeHtml(greeting)}</p>` : ""}
    <p style="margin:0 0 14px;">${summaryHtml}</p>
    ${intro ? `<p style="margin:0 0 14px;color:#5B6880;">${escapeHtml(intro)}</p>` : ""}
    ${link ? '<p style="margin:0;">' + copy.instructions + '</p>' + renderCtaButton(copy.cta, link) : ""}
    ${sectionsHtml}
  </div>`;

  const html = renderBrandedEmail({
    preheader: summary,
    heading,
    subheading,
    contentHtml,
    noteHtml: renderQuoteEmailFooterHtml(footer),
    locale,
  });

  return { subject, text, html };
}
