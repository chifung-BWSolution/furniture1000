import { resolveQuoteCompanyPhone } from "../../../src/lib/quoteCompanyPhone.ts";
import { escapeHtml } from "./escapeHtml.ts";

export interface QuoteEmailFooterText {
  "zh-Hant": string;
  "zh-Hans": string;
  en: string;
}

const signatureLinks = [
  ["Our Latest Furniture Category PDF", "https://bwoffice.asia/pages/catalog", "https://bwoffice.asia/pages/catalog"],
  ["Online Store:", "www.bwfurnitures.com", "https://www.bwfurnitures.com"],
  ["Brand Furniture:", "www.bwoffice.asia", "https://www.bwoffice.asia"],
] as const;

function legacyPmQuoteEmailFooter(name: string, workPhone: string): QuoteEmailFooterText {
  const phone = workPhone.trim();
  return {
    "zh-Hant": [name, "項目經理｜BW Furniture", phone && "電話：" + phone].filter(Boolean).join("\n"),
    "zh-Hans": [name, "项目经理｜BW Furniture", phone && "电话：" + phone].filter(Boolean).join("\n"),
    en: [name, "Project Manager | BW Furniture", phone && "Tel: " + phone].filter(Boolean).join("\n"),
  };
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
  ].join("\n\n");
  return { "zh-Hant": signature, "zh-Hans": signature, en: signature };
}

export function refreshDefaultQuoteEmailFooter(footer: QuoteEmailFooterText): QuoteEmailFooterText {
  const updated = { ...footer };
  for (const locale of ["zh-Hant", "zh-Hans", "en"] as const) {
    const text = footer[locale];
    const [name, , phone = ""] = text.split("\n");
    const workPhone = phone.replace(/^(?:電話：|电话：|Tel: )/, "");
    if (name && text === legacyPmQuoteEmailFooter(name, workPhone)[locale]) {
      updated[locale] = defaultPmQuoteEmailFooter(name, workPhone)[locale];
    }
  }
  return updated;
}

export function renderQuoteEmailFooterHtml(footer: string): string {
  return footer.split(/\r?\n/).map((line) => {
    const link = signatureLinks.find(([, text]) => text === line);
    return link ? `<a href="${link[2]}">${escapeHtml(line)}</a>` : escapeHtml(line);
  }).join("<br>");
}
