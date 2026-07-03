/** Default 條款及付款 text for new quotation drafts. */

export const DELIVERY_ADDRESS_BLANK = "&nbsp;".repeat(48);

export const DEFAULT_QUOTATION_TERMS = {
  payment: `付款條款: 須支付70%訂金於生產前，餘下30%於交付前支付。若未支付餘款，本公司將不安排交付或安裝。




銀行賬戶資料:

戶口名稱: Branding Works Design Ltd

銀行名稱: 香港上海匯豐銀行

戶口號碼: 747-058683-001




若以支票轉賬/信用卡付款，貨期以實際款項到賬日期爲準。`,
  transport: `3.1 本報價包含於單一地址的一次性運輸及安裝費用。
3.2 交付暫不涵蓋大嶼山、長洲、坪洲、南丫島及其他離島地區，包括禁區、5.5噸貨車無法進入路段、展覽場地、倉庫、酒店、裝修單位、船屋、地盤或貨櫃碼頭。若需特殊運送（如經露台懸掛），客戶須自行安排或者另行收費。
3.3 送貨及安裝的標準時間：星期一至六，09:00-18:00（公眾假期除外）。超出時間須另行收費。
3.4 遇惡劣天氣 、洪水或道路封閉，交付可能延遲。本公司將於24 小時內聯絡，並於7 天內補送。
3.5 送貨及安裝期間，現場須安全、清潔且無阻礙，否則本公司保留拒絕權利。
3.6 安裝不包括電工服務（如電插座安裝）、吊櫃上牆和收口服務，建議聘請合格技工。
3.7 運輸過程若需要叩關，因叩關過程導致的送貨及安裝延誤，本公司不負任何責任。並可重新安排送貨時間。`,
  extraFees: `4.1 卸貨區高度須達3.3 米，否則街上卸貨每件加收HKD 200。
4.2 更改交付日期須於3 天前電郵通知，否則收取HKD 500 行政費。本公司提供首5 天免費儲存，逾期每日每立方米收取HKD80。
4.3 若交付當日無人接收，須重新安排並收取額外交付費。
4.4 清拆舊家具不包括在內，須另行報價。
4.5 樓梯搬運每層每立方米收取HKD 100（限8 層）。
4.6 交付限 100 米範圍，超出每100 米加收HKD 500。`,
  warranty: `5.1 保養期為 1 年，自交付日起計算。不適用於不當使用、意外損壞或正常磨損。超過保養期后，進行維修，只收取材料及運輸安裝費用。
5.2 如貨品有任何損壞或問題，客戶須於產品交付後7天内通知本公司。如貨品有任何損壞或問題而客人不接受時，上限只賠償為貨價10%。
5.3 瑕疵評估以 1000mm 距離觀察為準，輕微差異（如顏色或收邊）不在範圍。`,
  other: `6.1 產品貨款未全部付清之前，產品歸屬權為本公司。
6.2 若需家具安裝固定上墻，需要保證所安裝墻體具有足夠的受力，且必須安裝墻體背板用作安裝上墻的結構件。
6.3 產品顏色及花紋可能有輕微差異（因顯示器或批次），屬正常，不接受退換。
6.4 本報價以發票內容為準，圖片及樣本僅供參考。任何更改須以書面通知，本公司不接受口頭承諾。
6.5 所有規格經確認無誤。本合同經雙方簽署及蓋印後生效。
6.6 如合約產生任何爭議，雙方無法達成共識，爭議無法解決，將提交香港國際仲裁中心仲裁。
6.7 本報價有效期為30 天。
6.8 責任限制：本公司對間接損失（如延誤造成的商業損失）不承擔責任。最高賠償限於訂單總額。
6.9 不可抗力：如疫情、自然災害等不可控事件，本公司免除相關責任，但將盡力通知並減輕影響。`,
} as const;

export type QuotationDefaultTerms = typeof DEFAULT_QUOTATION_TERMS;

export type SavedTermsContent = {
  transport?: string;
  extraFees?: string;
  warranty?: string;
  other?: string;
  payment?: string;
  fullHtml?: string;
};

export type ResolvedTermsContent = {
  transport: string;
  extraFees: string;
  warranty: string;
  other: string;
  payment: string;
  fullHtml: string;
};

/** New template always opens with section 1「送貨地址」. */
export function isCurrentTermsFormat(terms?: SavedTermsContent | null): boolean {
  if (!terms?.fullHtml?.trim()) return false;
  return terms.fullHtml.includes("送貨地址");
}

export function migrateTermsContentToCurrent(
  saved?: SavedTermsContent | null,
  deliveryAddress?: string,
): ResolvedTermsContent {
  const addressFromMeta = (deliveryAddress ?? "").trim();

  if (saved && isCurrentTermsFormat(saved)) {
    const address =
      addressFromMeta ||
      extractDeliveryAddressFromTermsHtml(saved.fullHtml ?? "");
    let fullHtml =
      saved.fullHtml ?? buildDefaultTermsFullHtml(DEFAULT_QUOTATION_TERMS);
    if (address && !extractDeliveryAddressFromTermsHtml(fullHtml)) {
      fullHtml = injectDeliveryAddressIntoTermsHtml(fullHtml, address);
    }
    return {
      transport: saved.transport ?? DEFAULT_QUOTATION_TERMS.transport,
      extraFees: saved.extraFees ?? DEFAULT_QUOTATION_TERMS.extraFees,
      warranty: saved.warranty ?? DEFAULT_QUOTATION_TERMS.warranty,
      other: saved.other ?? DEFAULT_QUOTATION_TERMS.other,
      payment: saved.payment ?? DEFAULT_QUOTATION_TERMS.payment,
      fullHtml,
    };
  }

  let fullHtml = buildDefaultTermsFullHtml(DEFAULT_QUOTATION_TERMS);
  if (addressFromMeta) {
    fullHtml = injectDeliveryAddressIntoTermsHtml(fullHtml, addressFromMeta);
  }
  return {
    transport: DEFAULT_QUOTATION_TERMS.transport,
    extraFees: DEFAULT_QUOTATION_TERMS.extraFees,
    warranty: DEFAULT_QUOTATION_TERMS.warranty,
    other: DEFAULT_QUOTATION_TERMS.other,
    payment: DEFAULT_QUOTATION_TERMS.payment,
    fullHtml,
  };
}

function linesToParagraphs(text: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() ? `<p>${l}</p>` : "<p></p>"))
    .join("");
}

export function buildDefaultTermsFullHtml(
  terms: QuotationDefaultTerms = DEFAULT_QUOTATION_TERMS,
): string {
  return [
    `<p>1&nbsp;&nbsp;送貨地址&nbsp;:</p>`,
    `<p><u>${DELIVERY_ADDRESS_BLANK}</u></p>`,
    `<h3>2&nbsp;&nbsp;付款資料</h3>`,
    linesToParagraphs(terms.payment),
    `<h3>3&nbsp;&nbsp;運輸及安裝條款</h3>`,
    linesToParagraphs(terms.transport),
    `<h3>4&nbsp;&nbsp;額外費用</h3>`,
    linesToParagraphs(terms.extraFees),
    `<h3>5&nbsp;&nbsp;保養及維修</h3>`,
    linesToParagraphs(terms.warranty),
    `<h3>6&nbsp;&nbsp;其他</h3>`,
    linesToParagraphs(terms.other),
  ].join("");
}

function normalizeUnderlineText(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Read user input from the first underline blank (section 1 送貨地址). */
export function extractDeliveryAddressFromTermsHtml(html: string): string {
  if (!html) return "";
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const underline = doc.querySelector("u");
    if (underline) return normalizeUnderlineText(underline.innerHTML);
  }
  const match = html.match(/<u[^>]*>([\s\S]*?)<\/u>/i);
  return match ? normalizeUnderlineText(match[1]) : "";
}

export function injectDeliveryAddressIntoTermsHtml(
  html: string,
  address: string,
): string {
  const trimmed = address.trim();
  if (!trimmed || !html) return html;
  const escaped = trimmed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return html.replace(/<u[^>]*>[\s\S]*?<\/u>/i, `<u>${escaped}</u>`);
}

export function resolveDeliveryAddress(
  termsHtml: string,
  quoteMetaAddress?: string,
): string {
  const fromMeta = (quoteMetaAddress ?? "").trim();
  if (fromMeta) return fromMeta;
  return extractDeliveryAddressFromTermsHtml(termsHtml);
}

export function isDeliveryAddressFilled(
  termsHtml: string,
  quoteMetaAddress?: string,
): boolean {
  return resolveDeliveryAddress(termsHtml, quoteMetaAddress).length > 0;
}
