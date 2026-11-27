import { resolveQuoteCompanyPhone } from "../../../src/lib/quoteCompanyPhone.ts";
import { escapeHtml } from "./escapeHtml.ts";

export interface QuoteEmailFooterText {
  "zh-Hant": string;
  "zh-Hans": string;
  en: string;
}

const signatureLinks = [
  ["YouTube 頻道", "https://www.youtube.com/@bwoffice-furniture", "https://www.youtube.com/@bwoffice-furniture"],
  ["Our Latest Furniture Category PDF", "https://bwoffice.asia/pages/catalog", "https://bwoffice.asia/pages/catalog"],
  ["Brand Furniture:", "www.bwoffice.asia", "https://www.bwoffice.asia"],
] as const;

const legacySignatureLinks = [
  ["Our Latest Furniture Category PDF", "https://bwoffice.asia/pages/catalog", "https://bwoffice.asia/pages/catalog"],
  ["Online Store:", "www.bwfurnitures.com", "https://www.bwfurnitures.com"],
  ["Brand Furniture:", "www.bwoffice.asia", "https://www.bwoffice.asia"],
] as const;

const linkableFooterLines = [
  ...signatureLinks,
  ...legacySignatureLinks,
] as const;

const PREVIOUS_DEFAULT_CLOSING = [
  "BW Office Furniture (since 2009)",
  ...legacySignatureLinks.map(([label, text]) => `${label}\n${text}`),
].join("\n\n");

function legacyPmQuoteEmailFooter(name: string, workPhone: string): QuoteEmailFooterText {
  const phone = workPhone.trim();
  return {
    "zh-Hant": [name, "項目經理｜BW Furniture", phone && "電話：" + phone].filter(Boolean).join("\n"),
    "zh-Hans": [name, "项目经理｜BW Furniture", phone && "电话：" + phone].filter(Boolean).join("\n"),
    en: [name, "Project Manager | BW Furniture", phone && "Tel: " + phone].filter(Boolean).join("\n"),
  };
}

export const DEFAULT_QUOTE_EMAIL_BCC = "sale@bwteam-furniture.com";

const ROLE_LINE = /^(?:項目經理｜|项目经理｜|Project Manager \| )/;
const PHONE_LINE = /^(?:電話：|电话：|Tel:\s*|mobile\s+|direct\s+)(.+)$/i;

/** Company introduction and links, without the colleague's name or phone. */
export function defaultQuoteEmailClosing(): string {
  return [
    "BW Office Furniture (since 2009)",
    ...signatureLinks.map(([label, text]) => `${label}\n${text}`),
  ].join("\n");
}

/** Phone stored for a PM: the mapped direct/mobile pair, otherwise the PMS work phone. */
export function defaultQuoteEmailPhone(name: string, workPhone: string): string {
  return resolveQuoteCompanyPhone({ name })?.trim() || workPhone.trim();
}

export function defaultPmQuoteEmailFooter(name: string, workPhone: string): QuoteEmailFooterText {
  const [direct, mobile] = resolveQuoteCompanyPhone({ name })?.split("/").map((part) => part.trim()) ?? [];
  const mobilePhone = mobile || workPhone.trim();
  const contact = [
    name,
    mobilePhone && `mobile ${mobilePhone}`,
    direct && `direct ${direct}`,
    "BW Office Furniture (since 2009)",
  ].filter(Boolean).join("\n");
  const signature = [
    contact,
    ...signatureLinks.map(([label, text]) => `${label}\n${text}`),
  ].join("\n");
  return { "zh-Hant": signature, "zh-Hans": signature, en: signature };
}

/**
 * Older rows store the name and phone inside the signature text.
 * A signature that does not start with the colleague's name is already just the closing.
 */
export function splitQuoteEmailClosing(body: string, name: string): { phone: string; closing: string } {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const trimmedName = name.trim();
  if (!trimmedName || lines[0]?.trim() !== trimmedName) {
    return { phone: "", closing: body.trim() };
  }
  let index = 1;
  const phones: string[] = [];
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }
    if (ROLE_LINE.test(line)) {
      index += 1;
      continue;
    }
    const match = line.match(PHONE_LINE);
    if (match) {
      phones.push(match[1].trim());
      index += 1;
      continue;
    }
    break;
  }
  while (index < lines.length && !lines[index].trim()) index += 1;
  return {
    phone: phones.filter(Boolean).join(" / "),
    closing: lines.slice(index).join("\n").trim(),
  };
}

function phoneNumbers(value: string): string[] {
  return value.split(/[/／\n]/).map((part) => part.replace(/^(?:mobile|direct|電話：|电话：|Tel:)\s*/i, "").trim()).filter(Boolean);
}

function samePhoneSet(left: string, right: string): boolean {
  const digits = (value: string) => phoneNumbers(value).map((part) => part.replace(/\D/g, "")).filter(Boolean).sort().join(",");
  const key = digits(left);
  return key !== "" && key === digits(right);
}

/** Email signatures list the mobile line, then the direct line. */
export function signaturePhoneLines(name: string, phone: string): string[] {
  const raw = phone.trim();
  if (!raw) return [];
  const labeled = raw.split(/\n/).map((line) => line.trim()).filter((line) => /^(?:mobile|direct)\s/i.test(line));
  if (labeled.length) {
    return labeled.map((line) => line.replace(/^(mobile|direct)\s+/i, (_, label: string) => label.toLowerCase() + " "));
  }
  const mapped = resolveQuoteCompanyPhone({ name }) ?? "";
  const canonical = mapped && samePhoneSet(mapped, raw) ? mapped : raw;
  const parts = phoneNumbers(canonical);
  if (parts.length >= 2) {
    const [direct, mobile] = parts;
    return [`mobile ${mobile}`, `direct ${direct}`];
  }
  return parts.length === 1 ? [`mobile ${parts[0]}`] : [];
}

export function presentQuoteEmailSignature(input: {
  name: string;
  phone: string;
  body: string;
  locale?: string;
}): string {
  const name = input.name.trim();
  const split = splitQuoteEmailClosing(input.body, name);
  const phone = input.phone.trim() || split.phone;
  const head = [name, ...signaturePhoneLines(name, phone)].filter(Boolean).join("\n");
  if (!head) return split.closing;
  if (!split.closing) return head;
  return `${head}\n${split.closing}`;
}

export interface QuoteEmailSenderSource {
  pm_name: string;
  sender_name?: string | null;
  phone?: string | null;
  body_zh_hant: string;
  body_zh_hans: string;
  body_en: string;
}

export function materializeQuoteEmailFooter(row: QuoteEmailSenderSource): {
  footer: QuoteEmailFooterText;
  senderName: string;
  phone: string;
} {
  const refreshed = refreshDefaultQuoteEmailFooter({
    "zh-Hant": row.body_zh_hant,
    "zh-Hans": row.body_zh_hans,
    en: row.body_en,
  });
  const senderName = (row.sender_name || row.pm_name || "").trim();
  const phone = (row.phone || splitQuoteEmailClosing(refreshed["zh-Hant"], senderName).phone).trim();
  return {
    senderName,
    phone,
    footer: {
      "zh-Hant": presentQuoteEmailSignature({ name: senderName, phone, body: refreshed["zh-Hant"], locale: "zh-Hant" }),
      "zh-Hans": presentQuoteEmailSignature({ name: senderName, phone, body: refreshed["zh-Hans"], locale: "zh-Hans" }),
      en: presentQuoteEmailSignature({ name: senderName, phone, body: refreshed.en, locale: "en" }),
    },
  };
}

/** Fields shown in 電郵設定. The stored signature text keeps only the closing. */
export function quoteEmailSenderDraft(row: QuoteEmailSenderSource): {
  sender_name: string;
  phone: string;
  body_zh_hant: string;
  body_zh_hans: string;
  body_en: string;
} {
  const refreshed = refreshDefaultQuoteEmailFooter({
    "zh-Hant": row.body_zh_hant,
    "zh-Hans": row.body_zh_hans,
    en: row.body_en,
  });
  const senderName = (row.sender_name || row.pm_name || "").trim();
  const hant = splitQuoteEmailClosing(refreshed["zh-Hant"], senderName);
  const hans = splitQuoteEmailClosing(refreshed["zh-Hans"], senderName);
  const en = splitQuoteEmailClosing(refreshed.en, senderName);
  return {
    sender_name: senderName,
    phone: (row.phone || hant.phone || hans.phone || en.phone).trim(),
    body_zh_hant: hant.closing,
    body_zh_hans: hans.closing,
    body_en: en.closing,
  };
}

export function quoteEmailFromHeader(senderName: string): string {
  const name = senderName.replace(/[\r\n<>"]/g, "").trim().slice(0, 120);
  const display = name ? `${name} | BW Furniture` : "BW Furniture";
  return `${display} <sale@bwteam-furniture.com>`;
}

export function quoteEmailBccList(recipient: string, teamBcc: string): string[] {
  const bcc = teamBcc.trim();
  if (!bcc || bcc.toLowerCase() === recipient.trim().toLowerCase()) return [];
  return [bcc];
}

export function refreshDefaultQuoteEmailFooter(footer: QuoteEmailFooterText): QuoteEmailFooterText {
  const updated = { ...footer };
  const normalizeClosing = (value: string) => value.replace(/\r\n/g, "\n").trim();
  const previousClosingNormalized = normalizeClosing(PREVIOUS_DEFAULT_CLOSING);
  for (const locale of ["zh-Hant", "zh-Hans", "en"] as const) {
    const text = footer[locale];
    const normalized = normalizeClosing(text);
    if (normalized === previousClosingNormalized) {
      updated[locale] = defaultQuoteEmailClosing();
      continue;
    }
    const [name, , phone = ""] = text.split("\n");
    const workPhone = phone.replace(/^(?:電話：|电话：|Tel: )/, "");
    if (name && text === legacyPmQuoteEmailFooter(name, workPhone)[locale]) {
      updated[locale] = defaultPmQuoteEmailFooter(name, workPhone)[locale];
      continue;
    }
    if (name && normalized.endsWith(previousClosingNormalized)) {
      const prefix = normalized.slice(0, normalized.length - previousClosingNormalized.length).trim();
      const closing = defaultQuoteEmailClosing();
      updated[locale] = prefix ? `${prefix}\n${closing}` : closing;
    }
  }
  return updated;
}

export function renderQuoteEmailFooterHtml(footer: string): string {
  return footer.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    const link = linkableFooterLines.find(([, text]) => text === trimmed);
    return link
      ? `<a href="${link[2]}" style="color:#2F6BED;text-decoration:none;">${escapeHtml(line)}</a>`
      : escapeHtml(line);
  }).join("<br>");
}
