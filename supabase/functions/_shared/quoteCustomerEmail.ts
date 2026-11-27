import { renderQuoteEmailFooterHtml, type QuoteEmailFooterText } from "./quoteEmailFooter.ts";

/**
 * FDS-15 customer-facing quotation email (manual send and 3-day follow-up).
 *
 * Kept pure TypeScript (no Deno-only APIs, no `@/` aliases) so Vite frontend,
 * Deno Edge Functions, and Node unit tests share one exact email builder.
 */

import { escapeHtml } from "./escapeHtml.ts";
import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
} from "./brandedEmail.ts";

export const QUOTE_EMAIL_LOCALES = {
  "zh-Hant": "繁體",
  "zh-Hans": "简体",
  en: "英文",
} as const;

export type QuoteEmailLocale = keyof typeof QUOTE_EMAIL_LOCALES;
export type QuoteClientType = "school" | "gov_ngo" | "commercial";

export function normalizeQuoteEmailLocale(value: unknown): QuoteEmailLocale {
  return value === "zh-Hans" || value === "en" ? value : "zh-Hant";
}

/** Use the contact person. Drop a company name that was stored in the same field. */
export function quoteEmailAddressee(contact?: string | null, company?: string | null): string {
  let person = String(contact ?? "").replace(/\s+/g, " ").trim();
  const organization = String(company ?? "").replace(/\s+/g, " ").trim();
  const namedOrganization = organization && !/^n\/a$/i.test(organization) ? organization : "";
  if (person && namedOrganization && person.includes(namedOrganization)) {
    person = person.replace(namedOrganization, " ").replace(/\s+/g, " ").trim() || person;
  }
  const latinName = person.match(/^([A-Za-z][A-Za-z .'-]*[A-Za-z])\s+\p{Script=Han}/u);
  if (latinName) return latinName[1].replace(/\s+/g, " ").trim();
  return person || namedOrganization;
}

export function defaultQuoteEmailGreeting(name: string, locale: QuoteEmailLocale = "zh-Hant"): string {
  const who = name.trim();
  if (!who) return "";
  if (locale === "en" || /^[A-Za-z][A-Za-z .'-]*[A-Za-z]$/.test(who) || /^[A-Za-z]$/.test(who)) {
    return `Dear ${who},`;
  }
  return `${who}您好：`;
}

function cleanOrganizationName(value?: string | null): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || /^n\/a$/i.test(text)) return "";
  return text;
}

function versionSequence(version?: string | null): number {
  const s = String(version ?? "").trim();
  const simple = s.match(/^v(\d+)$/i);
  if (simple) return parseInt(simple[1], 10);
  const legacy = s.match(/^v(\d+)\.(\d+)$/i);
  if (legacy) return parseInt(legacy[2], 10);
  const rev = s.match(/^r(\d+)$/i);
  if (rev) return parseInt(rev[1], 10);
  return 0;
}

/** Format quotation number with revision label, e.g. BWF-SH26-126 + v1 -> BWF-SH26-126 R1. */
export function formatQuoteEmailRef(quoteId: string, version?: string | null): string {
  const number = String(quoteId ?? "").trim();
  const seq = versionSequence(version);
  const rev = seq > 0 ? `R${seq}` : "";
  if (!number) return rev;
  if (!rev) return number;
  const stripped = number.replace(/[\s_\-]*[vVrR]\d+$/, "").trim() || number;
  return `${stripped} ${rev}`;
}

export function detectQuoteClientType(
  clientName?: string | null,
  clientIndustry?: string[] | null,
  quoteId?: string | null,
): QuoteClientType {
  const joined = [
    String(clientName ?? ""),
    ...(Array.isArray(clientIndustry) ? clientIndustry.map((v) => String(v ?? "")) : []),
  ].join(" ");
  const code = String(quoteId ?? "").trim();
  if (
    /小學|小学|中學|中学|學校|学校|幼稚園|幼稚园|書院|书院|學院|学院|大學|大学|官立|津貼|資助小學|資助中學|school|college|university|kindergarten|academy|primary|secondary/i.test(joined) ||
    /(?:^|-)SH\d/i.test(code)
  ) {
    return "school";
  }
  if (
    /政府單位|政府部门|政府機構|政府机构|非牟利|非營利|非营利|非政府|慈善|社福|福利會|福利会|基金會|基金会|基督教|社會服務|社会服务|ngo|government|gov|charity|non-?profit|foundation|ymca|ywca/i.test(joined) ||
    /(?:^|-)(?:NGO|GOV)\d/i.test(code)
  ) {
    return "gov_ngo";
  }
  return "commercial";
}

function shortPmName(pmName?: string | null): string {
  const name = String(pmName ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  const latinFirst = name.match(/^([A-Za-z][A-Za-z.'-]*)\s+[A-Za-z]/);
  if (latinFirst) return latinFirst[1];
  return name;
}

export function stripHtmlToSpecText(raw?: string | null, locale: QuoteEmailLocale = "zh-Hant"): string {
  const source = String(raw ?? "").trim();
  if (!source) return "";
  const text = source
    .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, digits: string) => {
      const code = Number(digits);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*(?:\d+\s*[、.．)\]]\s*|[•·\-–—*]\s*)/, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  const sep = locale === "en" ? "; " : "；";
  return lines.join(sep);
}

function cleanDim(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text || text === "0") return "";
  return text;
}

export function formatQuoteItemDimensions(item: QuoteEmailPreviewItem): string {
  const l = cleanDim(item.dimensionLMm);
  const w = cleanDim(item.dimensionWMm);
  const h = cleanDim(item.dimensionHMm);
  if (!l && !w && !h) return "";
  if (item.dimensionMode === "dh") {
    if (l && h && !w) return `Ø${l} x H${h} mm`;
    if (l && !w && !h) return `Ø${l} mm`;
  }
  const parts: string[] = [];
  if (l) parts.push(`W${l}`);
  if (w) parts.push(`D${w}`);
  if (h) parts.push(`H${h}`);
  return parts.length ? `${parts.join(" x ")} mm` : "";
}

const SERVICE_FEE_NAME_RE =
  /(?:安裝及運費|安装及运费|清拆走舊|清拆走旧|運費|运费|運輸費|运输费|搬運|搬运|拆走|棄置|弃置|送貨費|送货费|上樓費|上楼费|行政費|行政费|雜費|杂费|delivery|installation|transport|freight|shipping|disposal|dismantl|removal|stair|handling fee)/i;

export function isQuoteServiceFeeItem(item: QuoteEmailPreviewItem): boolean {
  const hasDim = Boolean(cleanDim(item.dimensionLMm) || cleanDim(item.dimensionWMm) || cleanDim(item.dimensionHMm));
  const hasMaterial = Boolean(stripHtmlToSpecText(item.material));
  if (hasDim || hasMaterial) return false;
  return SERVICE_FEE_NAME_RE.test(String(item.name ?? "").trim());
}

function normalizeRows(input: QuoteCustomerEmailInput, locale: QuoteEmailLocale): QuoteEmailPreviewItem[] {
  const structured = Array.isArray(input.previewItems) ? input.previewItems : [];
  const rows = structured.flatMap((item) => {
    const name = String(item?.name ?? "").trim();
    if (!name) return [];
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    return [{
      name: name.slice(0, 240),
      image: item.image ?? null,
      quantity: Number.isFinite(quantity) ? quantity : null,
      unit: String(item.unit ?? "").trim().slice(0, 20),
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
      material: item.material ?? null,
      color: item.color ?? null,
      remarks: item.remarks ?? null,
      dimensionLMm: item.dimensionLMm ?? null,
      dimensionWMm: item.dimensionWMm ?? null,
      dimensionHMm: item.dimensionHMm ?? null,
      dimensionMode: item.dimensionMode ?? null,
      category: item.category ?? null,
    }];
  });
  if (rows.length) return rows;
  return namesFromSample(String(input.sampleItems ?? ""), locale).map((name) => ({ name }));
}

export function deriveDefaultProductTitle(
  items: QuoteEmailPreviewItem[],
  locale: QuoteEmailLocale = "zh-Hant",
): string {
  const furniture = items.filter((item) => item.name.trim() && !isQuoteServiceFeeItem(item));
  const source = furniture.length ? furniture : items.filter((item) => item.name.trim());
  const names = [...new Set(source.map((item) => item.name.trim()).filter(Boolean))];
  if (!names.length) {
    return locale === "en" ? "Furniture" : locale === "zh-Hans" ? "家具" : "傢俬";
  }
  if (names.length === 1) return names[0].slice(0, 40);
  if (names.length === 2 && locale !== "en") {
    const combined = `${names[0]}及${names[1]}`;
    return combined.length <= 18 ? combined : names.join("、").slice(0, 40);
  }
  if (locale === "en") {
    return names.length === 2 ? `${names[0]} & ${names[1]}`.slice(0, 60) : "Office & School Furniture";
  }
  return `${names[0]}、${names[1]}`.slice(0, 40);
}

const HIGHLIGHTS_LIMIT = 15;

export function buildDefaultProductHighlights(
  items: QuoteEmailPreviewItem[],
  sampleItems?: string | null,
  locale: QuoteEmailLocale = "zh-Hant",
): string {
  const baseRows: QuoteEmailPreviewItem[] = items.length
    ? items
    : namesFromSample(String(sampleItems ?? ""), locale).map((name): QuoteEmailPreviewItem => ({ name }));
  const furniture = baseRows.filter((item) => item.name.trim() && !isQuoteServiceFeeItem(item));
  const displayRows = furniture.length ? furniture : baseRows.filter((item) => item.name.trim());
  if (!displayRows.length) {
    return locale === "en"
      ? "Please refer to the attached quotation and online platform for full product specifications."
      : locale === "zh-Hans"
        ? "产品详细规格及报价内容请参阅附件报价单及线上服务平台。"
        : "產品詳細規格及報價內容請參閱附件報價單及線上服務平台。";
  }

  const shown = displayRows.slice(0, HIGHLIGHTS_LIMIT);
  const lines = shown.map((item, index) => {
    const qty = quantityText(item.quantity, item.unit);
    const hasQty = qty !== "—";
    const dims = formatQuoteItemDimensions(item);
    const mat = stripHtmlToSpecText(item.material, locale);
    const color = String(item.color ?? "").trim();
    const meaningfulColor = color && !/^(?:按圖|按图|as shown|tbc|n\/a)$/i.test(color) ? color : "";
    const remarks = String(item.remarks ?? "").replace(/\s+/g, " ").trim();

    if (locale === "en") {
      const detailParts = [
        dims ? `Dimensions: ${dims}` : "",
        mat,
        meaningfulColor ? `Colour: ${meaningfulColor}` : "",
        remarks,
      ].filter(Boolean);
      const qtyLabel = hasQty ? ` (${qty})` : "";
      const detail = detailParts.length ? `: ${detailParts.join("; ")}.` : ".";
      return `${index + 1}. ${item.name}${qtyLabel}${detail}`;
    }

    const dimLabel = dims ? (locale === "zh-Hans" ? `尺寸 ${dims}` : `尺寸 ${dims}`) : "";
    const colorLabel = meaningfulColor ? (locale === "zh-Hans" ? `颜色：${meaningfulColor}` : `顏色：${meaningfulColor}`) : "";
    const detailParts = [dimLabel, mat, colorLabel, remarks].filter(Boolean);
    const qtyLabel = hasQty ? `（${qty}）` : "";
    const sep = "。";
    const detail = detailParts.length ? `：${detailParts.join(sep)}。` : "";
    return `${index + 1}. ${item.name}${qtyLabel}${detail}`;
  });

  const remaining = displayRows.length - shown.length;
  if (remaining > 0) {
    lines.push(
      locale === "en"
        ? `Plus ${remaining} more item${remaining === 1 ? "" : "s"} — see the attached quotation or online platform for full details.`
        : locale === "zh-Hans"
          ? `另附其余 ${remaining} 项产品，完整清单请参阅附件报价单或线上服务平台。`
          : `另附其餘 ${remaining} 項產品，完整清單請參閱附件報價單或線上服務平台。`,
    );
  }
  return lines.join("\n");
}

export function buildDefaultQuoteEmailSubject(input: {
  kind: "manual" | "follow_up";
  quoteId: string;
  version?: string | null;
  clientName?: string | null;
  productTitle?: string | null;
  locale?: string;
}): string {
  const locale = normalizeQuoteEmailLocale(input.locale);
  const copy = copyByLocale[locale];
  const quoteRef = formatQuoteEmailRef(input.quoteId, input.version) || copy.quote;
  const client = cleanOrganizationName(input.clientName);
  const title = String(input.productTitle ?? "").trim() || copy.defaultProductTitle;
  const base = copy.subject(title, client, quoteRef);
  return input.kind === "follow_up" ? `${copy.followUpPrefix}${base}` : base;
}

const copyByLocale = {
  "zh-Hant": {
    quote: "傢俬方案",
    defaultProductTitle: "傢俬",
    followUpPrefix: "跟進：",
    subject: (title: string, client: string, quoteRef: string) =>
      `BW Furniture ${title}報價單${client ? `- ${client}` : ""} (報價單號：${quoteRef})`,
    orgRef: (type: QuoteClientType) => (type === "school" ? "貴校" : type === "gov_ngo" ? "貴機構" : "貴司"),
    openingManual: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `感謝${orgRef}${clientParen}對本公司的信任與支持。隨函附上${orgRef}所需的${title}報價單${quoteRefParen}，供您審閱。為方便您快速掌握重點，以下為是次報價的產品及服務總覽：`,
    openingFollowUp: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `謹此跟進早前為${orgRef}${clientParen}準備的${title}報價單${quoteRefParen}，供您審閱。為方便您快速掌握重點，以下為是次報價的產品及服務總覽：`,
    quoteRefParen: (quoteRef: string) => `（報價單號：${quoteRef}）`,
    specsHeading: "【產品規格及材質重點】",
    platformIntro:
      "附件是我們的報價單，如果您對報價單有任何意見，或者想瀏覽我們其他產品，歡迎到這張報價單對應的線上服務平台瀏覽及修改，我們的項目經理之後便會聯絡您：",
    termsHeading: "【交付及付款安排】",
    leadTimeLabel: "貨期",
    leadTimeOrgDefault: "確認訂單後預計 3–4 週完成生產；交付及安裝分兩日進行，交付後 1–2 個工作日內完成安裝。",
    leadTimeCommercialDefault: "收到訂金後預計 3–4 週完成生產；交付及安裝分兩日進行，交付後 1–2 個工作日內完成安裝。",
    paymentLabel: "付款條款",
    paymentSchool: "政府及資助學校可在確認訂單後安排生產，並於收貨後 30 天內付清全款。",
    paymentGovNgo: "政府單位及非牟利機構可在確認訂單後安排生產，並於收貨後 30 天內付清全款。",
    paymentCommercialDefault: "須支付 70% 訂金於生產前，餘下 30% 於交付前付清。",
    warrantyLabel: "保養期",
    warrantyLine: (years: number, days: number) => `自交付日起計 ${years} 年原廠保養（報價有效期為 ${days} 天）。`,
    aboutHeading: "【關於BW】",
    aboutBody:
      "BW Furniture（Branding Works Design Ltd）成立於 2009 年，專注為香港學校及商業機構提供一站式優質傢俱訂製與安裝服務，經驗豐富。",
    closingWithContact: (contact: string, orgRef: string) =>
      `如對報價單內容或細節有任何疑問，歡迎隨時致電 ${contact} 或回覆此電郵與我聯絡。期待為${orgRef}提供優質服務！`,
    closingNoPhone: (orgRef: string) =>
      `如對報價單內容或細節有任何疑問，歡迎隨時回覆此電郵與我聯絡。期待為${orgRef}提供優質服務！`,
    disclaimer: "此為系統發出的參考報價通知，正式報價以雙方確認的版本為準。",
  },
  "zh-Hans": {
    quote: "家具方案",
    defaultProductTitle: "家具",
    followUpPrefix: "跟进：",
    subject: (title: string, client: string, quoteRef: string) =>
      `BW Furniture ${title}报价单${client ? `- ${client}` : ""} (报价单号：${quoteRef})`,
    orgRef: (type: QuoteClientType) => (type === "school" ? "贵校" : type === "gov_ngo" ? "贵机构" : "贵司"),
    openingManual: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `感谢${orgRef}${clientParen}对本公司的信任与支持。随函附上${orgRef}所需的${title}报价单${quoteRefParen}，供您审阅。为方便您快速掌握重点，以下为本次报价的产品及服务总览：`,
    openingFollowUp: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `谨此跟进早前为${orgRef}${clientParen}准备的${title}报价单${quoteRefParen}，供您审阅。为方便您快速掌握重点，以下为本次报价的产品及服务总览：`,
    quoteRefParen: (quoteRef: string) => `（报价单号：${quoteRef}）`,
    specsHeading: "【产品规格及材质重点】",
    platformIntro:
      "附件是我们的报价单，如果您对报价单有任何意见，或者想浏览我们其他产品，欢迎到这张报价单对应的线上服务平台浏览及修改，我们的项目经理之后便会联络您：",
    termsHeading: "【交付及付款安排】",
    leadTimeLabel: "货期",
    leadTimeOrgDefault: "确认订单后预计 3–4 周完成生产；交付及安装分两日进行，交付后 1–2 个工作日内完成安装。",
    leadTimeCommercialDefault: "收到订金后预计 3–4 周完成生产；交付及安装分两日进行，交付后 1–2 个工作日内完成安装。",
    paymentLabel: "付款条款",
    paymentSchool: "政府及资助学校可在确认订单后安排生产，并于收货后 30 天内付清全款。",
    paymentGovNgo: "政府单位及非牟利机构可在确认订单后安排生产，并于收货后 30 天内付清全款。",
    paymentCommercialDefault: "须支付 70% 订金于生产前，余下 30% 于交付前付清。",
    warrantyLabel: "保修期",
    warrantyLine: (years: number, days: number) => `自交付日起计 ${years} 年原厂保修（报价有效期为 ${days} 天）。`,
    aboutHeading: "【关于BW】",
    aboutBody:
      "BW Furniture（Branding Works Design Ltd）成立于 2009 年，专注为香港学校及商业机构提供一站式优质家具订制与安装服务，经验丰富。",
    closingWithContact: (contact: string, orgRef: string) =>
      `如对报价单内容或细节有任何疑问，欢迎随时致电 ${contact} 或回复此电邮与我联络。期待为${orgRef}提供优质服务！`,
    closingNoPhone: (orgRef: string) =>
      `如对报价单内容或细节有任何疑问，欢迎随时回复此电邮与我联络。期待为${orgRef}提供优质服务！`,
    disclaimer: "此为系统发出的参考报价通知，正式报价以双方确认的版本为准。",
  },
  en: {
    quote: "Furniture Proposal",
    defaultProductTitle: "Furniture",
    followUpPrefix: "Follow-up: ",
    subject: (title: string, client: string, quoteRef: string) =>
      `BW Furniture ${title} Quotation${client ? ` - ${client}` : ""} (Quotation No.: ${quoteRef})`,
    orgRef: (type: QuoteClientType) =>
      type === "school" ? "your school" : type === "gov_ngo" ? "your organisation" : "your company",
    openingManual: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `Thank you for your trust and support${clientParen}. Please find attached the ${title} quotation${quoteRefParen} prepared for ${orgRef} for your review. Below is an overview of the products and services included:`,
    openingFollowUp: (orgRef: string, clientParen: string, title: string, quoteRefParen: string) =>
      `Following up on the ${title} quotation${quoteRefParen} prepared for ${orgRef}. Below is an overview of the products and services included for your review:`,
    quoteRefParen: (quoteRef: string) => ` (Quotation No.: ${quoteRef})`,
    specsHeading: "[Product Specifications & Material Highlights]",
    platformIntro:
      "Please find our quotation attached. If you have any feedback or would like to browse our other products, you are welcome to view and request changes on this quotation's online platform, and our project manager will follow up with you:",
    termsHeading: "[Delivery & Payment Terms]",
    leadTimeLabel: "Lead Time",
    leadTimeOrgDefault: "Estimated 3–4 weeks for production upon order confirmation; delivery and installation take place over two days, completing installation within 1–2 working days after delivery.",
    leadTimeCommercialDefault: "Estimated 3–4 weeks for production upon deposit receipt; delivery and installation take place over two days, completing installation within 1–2 working days after delivery.",
    paymentLabel: "Payment Terms",
    paymentSchool: "Government and aided schools may proceed with production upon order confirmation, with full payment due within 30 days after delivery.",
    paymentGovNgo: "Government units and NGOs may proceed with production upon order confirmation, with full payment due within 30 days after delivery.",
    paymentCommercialDefault: "70% deposit before production commences, and the remaining 30% settled before delivery.",
    warrantyLabel: "Warranty",
    warrantyLine: (years: number, days: number) =>
      `${years}-year manufacturer warranty from the date of delivery (quotation valid for ${days} days).`,
    aboutHeading: "[About BW]",
    aboutBody:
      "Founded in 2009, BW Furniture (Branding Works Design Ltd) specializes in one-stop quality furniture customization and installation services for schools and commercial organizations in Hong Kong.",
    closingWithContact: (contact: string, orgRef: string) =>
      `Should you have any questions regarding the quotation details, please feel free to call ${contact} or reply to this email. We look forward to serving ${orgRef}!`,
    closingNoPhone: (orgRef: string) =>
      `Should you have any questions regarding the quotation details, please feel free to reply to this email. We look forward to serving ${orgRef}!`,
    disclaimer: "This automated quotation is for reference. The version confirmed by both parties takes precedence.",
  },
};

export const QUOTE_EMAIL_PREVIEW_LIMIT = 20;

export interface QuoteEmailPreviewItem {
  name: string;
  image?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  material?: string | null;
  color?: string | null;
  remarks?: string | null;
  dimensionLMm?: string | number | null;
  dimensionWMm?: string | number | null;
  dimensionHMm?: string | number | null;
  dimensionMode?: string | null;
  category?: string | null;
}

export interface QuoteCustomerEmailInput {
  kind: "manual" | "follow_up";
  quoteId: string;
  version?: string | null;
  clientName?: string | null;
  clientIndustry?: string[] | null;
  subjectOverride?: string | null;
  productTitle?: string | null;
  productHighlights?: string | null;
  introText?: string;
  customerName?: string | null;
  /** Exact opening line. An empty string leaves the greeting out. Omit it to build one from the customer name. */
  greeting?: string | null;
  locale?: string;
  footer?: QuoteEmailFooterText | null;
  customSections?: Array<{ title?: string; body?: string }>;
  itemCount: number;
  totalAmount: number;
  sampleItems?: string | null;
  previewItems?: QuoteEmailPreviewItem[] | null;
  shareUrl: string;
  deliveryDetails?: string | null;
  paymentTerms?: string | null;
  warrantyTerms?: string | null;
  validityDays?: string | number | null;
  pmName?: string | null;
  contactPhone?: string | null;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
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

function customSections(input: QuoteCustomerEmailInput): Array<{ title: string; body: string }> {
  if (!Array.isArray(input.customSections)) return [];
  return input.customSections.flatMap((section) => {
    const title = String(section?.title ?? "").trim().slice(0, 60);
    const body = String(section?.body ?? "").trim().slice(0, 800);
    if (!title && !body) return [];
    return [{ title, body }];
  });
}

function isFactoryDefaultDelivery(text: string): boolean {
  return (
    !text ||
    /訂單生產時間自收到訂金起計算|Production lead time:\s*3[–-]4 weeks upon receipt of deposit/i.test(text)
  );
}

function isFactoryDefaultPayment(text: string): boolean {
  return (
    !text ||
    /須支付\s*70%\s*訂金於生產前|A\s*70%\s*deposit\s*is\s*required\s*before\s*production/i.test(text)
  );
}

function resolveLeadTimeLine(
  deliveryDetails: string | null | undefined,
  clientType: QuoteClientType,
  locale: QuoteEmailLocale,
): string {
  const copy = copyByLocale[locale];
  const raw = String(deliveryDetails ?? "").replace(/\s+/g, " ").trim();
  if (raw && !isFactoryDefaultDelivery(raw)) {
    return raw;
  }
  return clientType === "commercial" ? copy.leadTimeCommercialDefault : copy.leadTimeOrgDefault;
}

function resolvePaymentLine(
  paymentTerms: string | null | undefined,
  clientType: QuoteClientType,
  locale: QuoteEmailLocale,
): string {
  const copy = copyByLocale[locale];
  if (clientType === "school") return copy.paymentSchool;
  if (clientType === "gov_ngo") return copy.paymentGovNgo;
  const raw = String(paymentTerms ?? "").trim();
  if (raw && !isFactoryDefaultPayment(raw)) {
    const firstParagraph = raw.split(/\r?\n\s*\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
    if (firstParagraph && firstParagraph.length <= 240) return firstParagraph;
  }
  return copy.paymentCommercialDefault;
}

function resolveWarrantyYears(warrantyTerms?: string | null): number {
  const match = String(warrantyTerms ?? "").match(/(\d+)\s*(?:年|years?)/i);
  const parsed = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 20 ? parsed : 1;
}

function resolveValidityDays(validityDays?: string | number | null): number {
  const parsed = parseInt(String(validityDays ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? parsed : 30;
}

function paragraphLinesHtml(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

export function buildQuoteCustomerEmail(input: QuoteCustomerEmailInput): BuiltEmail {
  const isFollowUp = input.kind === "follow_up";
  const locale = normalizeQuoteEmailLocale(input.locale);
  const copy = copyByLocale[locale];
  const footer = input.footer?.[locale] ?? copy.disclaimer;
  const rawQuoteId = String(input.quoteId ?? "").trim() || copy.quote;
  const quoteRef = formatQuoteEmailRef(rawQuoteId, input.version) || rawQuoteId;
  const clientName = cleanOrganizationName(input.clientName);
  const clientType = detectQuoteClientType(clientName, input.clientIndustry, rawQuoteId);
  const rows = normalizeRows(input, locale);
  const productTitle = String(input.productTitle ?? "").trim() || deriveDefaultProductTitle(rows, locale);
  const highlights = String(input.productHighlights ?? "").trim() ||
    buildDefaultProductHighlights(rows, input.sampleItems, locale);
  const intro = String(input.introText ?? "").trim();
  const customerName = String(input.customerName ?? "").trim().slice(0, 200);
  const greeting = input.greeting == null
    ? defaultQuoteEmailGreeting(customerName, locale)
    : String(input.greeting).trim().slice(0, 200);
  const link = String(input.shareUrl ?? "").trim();
  const sections = customSections(input);

  const defaultSubject = buildDefaultQuoteEmailSubject({
    kind: input.kind,
    quoteId: rawQuoteId,
    version: input.version,
    clientName,
    productTitle,
    locale,
  });
  const subjectOverride = String(input.subjectOverride ?? "").trim().slice(0, 300);
  const subject = subjectOverride
    ? (isFollowUp && !subjectOverride.startsWith(copy.followUpPrefix.trim())
      ? `${copy.followUpPrefix}${subjectOverride}`
      : subjectOverride)
    : defaultSubject;

  const orgRef = copy.orgRef(clientType);
  const clientParen = clientName
    ? (locale === "en" ? ` (${clientName})` : `（${clientName}）`)
    : "";
  const quoteRefParen = quoteRef ? copy.quoteRefParen(quoteRef) : "";
  const opening = isFollowUp
    ? copy.openingFollowUp(orgRef, clientParen, productTitle, quoteRefParen)
    : copy.openingManual(orgRef, clientParen, productTitle, quoteRefParen);

  const leadTimeLine = resolveLeadTimeLine(input.deliveryDetails, clientType, locale);
  const paymentLine = resolvePaymentLine(input.paymentTerms, clientType, locale);
  const warrantyLine = copy.warrantyLine(
    resolveWarrantyYears(input.warrantyTerms),
    resolveValidityDays(input.validityDays),
  );
  const arrangementBullets = [
    `- ${copy.leadTimeLabel}${locale === "en" ? ": " : "："}${leadTimeLine}`,
    `- ${copy.paymentLabel}${locale === "en" ? ": " : "："}${paymentLine}`,
    `- ${copy.warrantyLabel}${locale === "en" ? ": " : "："}${warrantyLine}`,
  ];

  const pmShort = shortPmName(input.pmName);
  const phone = String(input.contactPhone ?? "").replace(/\s+/g, " ").trim();
  const contactToken = [pmShort, phone].filter(Boolean).join(" ");
  const closingLine = contactToken
    ? copy.closingWithContact(contactToken, orgRef)
    : copy.closingNoPhone(orgRef);

  const text = [
    greeting,
    opening,
    intro,
    `${copy.specsHeading}\n${highlights}`,
    link ? `${copy.platformIntro} ${link}` : "",
    `${copy.termsHeading}\n${arrangementBullets.join("\n")}`,
    ...sections.map((section) => [section.title, section.body].filter(Boolean).join("\n")),
    `${copy.aboutHeading}\n${copy.aboutBody}`,
    closingLine,
    footer,
    companyFooterText(locale),
  ].filter(Boolean).join("\n\n");

  const sectionsHtml = sections.map((section) => `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E9EDF5;">
      ${section.title ? `<div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;font-weight:700;color:#0F1B3D;margin-bottom:6px;">${escapeHtml(section.title)}</div>` : ""}
      <div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.85;color:#1D2939;white-space:pre-wrap;">${escapeHtml(section.body)}</div>
    </div>`).join("");

  const highlightsHtml = highlights
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:6px 0 0;">${escapeHtml(line)}</p>`)
    .join("");

  const arrangementsHtml = arrangementBullets
    .map((line) => `<p style="margin:6px 0 0;">${escapeHtml(line)}</p>`)
    .join("");

  const platformHtml = link
    ? `<p style="margin:18px 0 0;">${escapeHtml(copy.platformIntro)} <a href="${escapeHtml(link)}" target="_blank" rel="noreferrer" style="color:#2F6BED;text-decoration:underline;word-break:break-all;">${escapeHtml(link)}</a></p>`
    : "";

  const contentHtml = `<div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.85;color:#1D2939;">
    ${greeting ? `<p style="margin:0 0 14px;font-weight:600;color:#0F1B3D;">${escapeHtml(greeting)}</p>` : ""}
    <p style="margin:0 0 16px;">${escapeHtml(opening)}</p>
    ${intro ? `<p style="margin:0 0 16px;color:#475467;">${paragraphLinesHtml(intro)}</p>` : ""}
    <div style="margin-top:18px;">
      <p style="margin:0 0 4px;font-weight:700;color:#0F1B3D;">${escapeHtml(copy.specsHeading)}</p>
      ${highlightsHtml}
    </div>
    ${platformHtml}
    <div style="margin-top:22px;">
      <p style="margin:0 0 4px;font-weight:700;color:#0F1B3D;">${escapeHtml(copy.termsHeading)}</p>
      ${arrangementsHtml}
    </div>
    ${sectionsHtml}
    <div style="margin-top:22px;">
      <p style="margin:0 0 4px;font-weight:700;color:#0F1B3D;">${escapeHtml(copy.aboutHeading)}</p>
      <p style="margin:0;">${escapeHtml(copy.aboutBody)}</p>
    </div>
    <p style="margin:18px 0 0;">${escapeHtml(closingLine)}</p>
  </div>`;

  const html = renderBrandedEmail({
    showHeader: false,
    preheader: opening,
    heading: subject,
    contentHtml,
    noteHtml: renderQuoteEmailFooterHtml(footer),
    locale,
  });

  return { subject, text, html };
}
