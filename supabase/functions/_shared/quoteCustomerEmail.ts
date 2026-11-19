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
    more: (n: number) => "另外還有 " + n + " 項，完整清單請在網上報價查看。",
    columns: ["傢俬", "數量", "金額"],
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
    more: (n: number) => "另外还有 " + n + " 项，完整清单请在网上报价查看。",
    columns: ["家具", "数量", "金额"],
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
    more: (n: number) => n + (n === 1 ? " more item. See the quotation online for the full list." : " more items. See the quotation online for the full list."),
    columns: ["Item", "Qty", "Amount"],
    emptySummary: "See the link below for your quotation.",
    instructions: "Use the button below to add items, change quantities, or request alternatives.",
    cta: "View quotation and request changes online",
    disclaimer: "This automated quotation is for reference. The version confirmed by both parties takes precedence.",
  },
};

export const QUOTE_EMAIL_PREVIEW_LIMIT = 5;

export interface QuoteEmailPreviewItem {
  name: string;
  image?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
}

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
  previewItems?: QuoteEmailPreviewItem[] | null;
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

function emailImageUrl(value: string | null | undefined): string {
  const src = String(value ?? "").trim();
  if (!/^https:\/\//i.test(src) || src.length > 2000) return "";
  return src;
}

function quantityText(quantity: number | null | undefined, unit: string | null | undefined): string {
  const amount = Number(quantity);
  if (!Number.isFinite(amount)) return "—";
  const qty = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 1000) / 1000);
  const label = String(unit ?? "").trim();
  return label ? `${qty} ${label}` : qty;
}

function namesFromSample(sample: string, locale: QuoteEmailLocale): string[] {
  const parts = locale === "en" ? sample.split(/、|, /) : sample.split("、");
  return parts.map((part) => part.trim()).filter(Boolean);
}

function previewRows(input: QuoteCustomerEmailInput, locale: QuoteEmailLocale): QuoteEmailPreviewItem[] {
  const structured = Array.isArray(input.previewItems) ? input.previewItems : [];
  const rows = structured.flatMap((item) => {
    const name = String(item?.name ?? "").trim();
    if (!name) return [];
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    return [{
      name: name.slice(0, 240),
      image: emailImageUrl(item.image),
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: String(item.unit ?? "").trim().slice(0, 20),
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
    }];
  });
  if (rows.length) return rows.slice(0, QUOTE_EMAIL_PREVIEW_LIMIT);
  return namesFromSample(String(input.sampleItems ?? ""), locale)
    .slice(0, QUOTE_EMAIL_PREVIEW_LIMIT)
    .map((name) => ({ name }));
}

function lineAmount(item: QuoteEmailPreviewItem): string {
  const price = Number(item.unitPrice);
  const quantity = Number(item.quantity);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return "—";
  return money(price * quantity);
}

function furnitureTableHtml(
  copy: (typeof copyByLocale)[QuoteEmailLocale],
  rows: QuoteEmailPreviewItem[],
  heading: string,
  hiddenCount: number,
): string {
  const headingHtml = heading
    ? `<p style="margin:0 0 14px;">${heading}</p>`
    : "";
  if (!rows.length) return headingHtml;
  const header = copy.columns.map((label, index) => {
    const align = index === 0 ? "left" : "right";
    return `<th align="${align}" style="padding:8px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;line-height:1.4;font-weight:700;color:#64748B;text-align:${align};">${escapeHtml(label)}</th>`;
  }).join("");
  const body = rows.map((item) => {
    const image = item.image
      ? `<img src="${escapeHtml(item.image)}" width="64" height="64" alt="${escapeHtml(item.name)}" style="display:block;width:64px;height:64px;object-fit:cover;border:0;border-radius:8px;background:#EEF2F8;">`
      : `<div style="width:64px;height:64px;background:#EEF2F8;border-radius:8px;"></div>`;
    return `<tr>
      <td width="84" valign="middle" style="padding:8px 10px;border-top:1px solid #E9EDF5;">${image}</td>
      <td valign="middle" style="padding:8px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.5;color:#0F1B3D;">${escapeHtml(item.name)}</td>
      <td valign="middle" align="right" style="padding:8px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.5;color:#1D2939;white-space:nowrap;text-align:right;">${escapeHtml(quantityText(item.quantity, item.unit))}</td>
      <td valign="middle" align="right" style="padding:8px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.5;color:#0F1B3D;font-weight:700;white-space:nowrap;text-align:right;">${escapeHtml(lineAmount(item))}</td>
    </tr>`;
  }).join("");
  const more = hiddenCount > 0
    ? `<p style="margin:10px 0 0;color:#5B6880;font-size:13px;line-height:1.6;">${escapeHtml(copy.more(hiddenCount))}</p>`
    : "";
  return `${headingHtml}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:0 0 16px;">
    <thead><tr style="background:#F4F6FB;"><th width="84" style="padding:8px 10px;font-size:0;line-height:0;">&nbsp;</th>${header}</tr></thead>
    <tbody>${body}</tbody>
  </table>${more}`;
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
  const sections = customSections(input);
  const rows = previewRows(input, locale);
  const hiddenCount = Math.max(0, count - rows.length);

  const summaryParts: string[] = [];
  if (count > 0) summaryParts.push(copy.count(count));
  if (total > 0) summaryParts.push(copy.total(money(total)));
  if (summaryParts.length === 0 && rows.length === 0) summaryParts.push(copy.emptySummary);
  const summary = [
    summaryParts.join(" "),
    ...rows.map((item) => [item.name, quantityText(item.quantity, item.unit), lineAmount(item)].filter((part) => part !== "—").join(" · ")),
    hiddenCount > 0 ? copy.more(hiddenCount) : "",
  ].filter(Boolean).join("\n");
  const summaryHtml = furnitureTableHtml(copy, rows, summaryParts.join(" "), hiddenCount);

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
    ${summaryHtml}
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
