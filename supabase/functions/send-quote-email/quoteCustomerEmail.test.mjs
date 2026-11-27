import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultPmQuoteEmailFooter,
  defaultQuoteEmailClosing,
  materializeQuoteEmailFooter,
  quoteEmailBccList,
  quoteEmailFromHeader,
  quoteEmailSenderDraft,
  refreshDefaultQuoteEmailFooter,
} from "../_shared/quoteEmailFooter.ts";
import {
  buildQuoteCustomerEmail,
  defaultQuoteEmailGreeting,
  detectQuoteClientType,
  formatQuoteEmailRef,
  quoteEmailAddressee,
} from "../_shared/quoteCustomerEmail.ts";

const QUOTE_ID = "BWF-SH26-126";
const SHARE_URL = "https://www.bwteam-furniture.com/q/6c851380";

function schoolSample(overrides = {}) {
  return buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: QUOTE_ID,
    version: "v1",
    clientName: "南元朗官立小學",
    clientIndustry: ["中小學 - Primary and School", "教育行業 - Education"],
    customerName: "曾先生",
    productTitle: "學生枱凳",
    pmName: "Luca Shen",
    contactPhone: "5163 4272 / 9717 3545",
    footer: defaultPmQuoteEmailFooter("Luca Shen", "9717 3545"),
    itemCount: 4,
    totalAmount: 97000,
    previewItems: [
      {
        name: "學生枱",
        quantity: 140,
        unit: "張",
        unitPrice: 350,
        dimensionLMm: "620",
        dimensionWMm: "450",
        dimensionHMm: "750",
        material: "<p>1、 桌子高度可調節為 750/720/690 三個檔位</p><p>2、桌子立柱採用厚度為 1.2 毫米的優質冷軋鋼管</p><p>3、檯面採用ABS注塑工藝</p>",
        color: "按圖",
      },
      {
        name: "學生膠凳",
        quantity: 140,
        unit: "張",
        unitPrice: 150,
        dimensionLMm: "420",
        dimensionWMm: "470",
        dimensionHMm: "735",
        material: "<p>1、全新工程聚丙PP材質</p>",
        color: "按圖",
      },
      {
        name: "安裝及運費",
        quantity: 1,
        unit: "項",
        unitPrice: 7000,
      },
      {
        name: "清拆走舊枱&凳",
        quantity: 135,
        unit: "套",
        unitPrice: 200,
      },
    ],
    shareUrl: SHARE_URL,
    ...overrides,
  });
}

test("renders the business-letter school quotation email without the old hero header", () => {
  const message = schoolSample();
  const plainHtml = message.html.replace(/<[^>]*>/g, "");

  assert.equal(message.subject, "BW Furniture 學生枱凳報價單- 南元朗官立小學 (報價單號：BWF-SH26-126 R1)");
  assert.doesNotMatch(message.html, /您的傢俬方案報價/);
  assert.doesNotMatch(message.html, /class="email-hero-icon"/);
  assert.doesNotMatch(message.html, /class="email-title"/);
  assert.match(message.text, /^曾先生您好：/);
  assert.match(plainHtml, /感謝貴校（南元朗官立小學）對本公司的信任與支持。隨函附上貴校所需的學生枱凳報價單（報價單號：BWF-SH26-126 R1）/);
  assert.match(plainHtml, /【產品規格及材質重點】/);
  assert.match(plainHtml, /1\. 學生枱（140 張）：尺寸 W620 x D450 x H750 mm/);
  assert.match(plainHtml, /2\. 學生膠凳（140 張）：尺寸 W420 x D470 x H735 mm/);
  assert.doesNotMatch(plainHtml, /安裝及運費/);
  assert.doesNotMatch(plainHtml, /清拆走舊枱/);
  assert.match(plainHtml, /【交付及付款安排】/);
  assert.match(plainHtml, /政府及資助學校可在確認訂單後安排生產，並於收貨後 30 天內付清全款/);
  assert.match(plainHtml, /自交付日起計 1 年原廠保養（報價有效期為 30 天）/);
  assert.match(plainHtml, /【關於BW】/);
  assert.match(plainHtml, /歡迎隨時致電 Luca 5163 4272 \/ 9717 3545 或回覆此電郵與我聯絡/);
  assert.doesNotMatch(message.html, /前往線上服務平台瀏覽及修改/);
  assert.doesNotMatch(message.html, /background-color:#2F6BED/);
  assert.match(message.html, /href="https:\/\/www\.bwteam-furniture\.com\/q\/6c851380"/);
  assert.match(message.text, /https:\/\/www\.bwteam-furniture\.com\/q\/6c851380/);
  assert.match(message.html, /href="https:\/\/www\.youtube\.com\/@bwoffice-furniture"/);
  assert.match(message.html, /href="https:\/\/bwoffice\.asia\/pages\/catalog"/);
  assert.match(message.html, /href="https:\/\/www\.bwoffice\.asia"/);
  assert.doesNotMatch(message.html, /bwfurnitures\.com/);
});

test("adapts opening and payment terms for commercial and NGO clients", () => {
  assert.equal(formatQuoteEmailRef("BWF-SH26-126", "v1"), "BWF-SH26-126 R1");
  assert.equal(detectQuoteClientType("XYZ Trading Limited", ["商業機構"], "BWF-OB26-001"), "commercial");
  assert.equal(detectQuoteClientType("基督教勵行會", [], "BWF-NGO26-077"), "gov_ngo");

  const commercial = schoolSample({
    quoteId: "BWF-OB26-001",
    version: "v2",
    clientName: "XYZ Trading Limited",
    clientIndustry: ["商業辦公"],
    productTitle: "",
  });
  assert.equal(commercial.subject, "BW Furniture 學生枱及學生膠凳報價單- XYZ Trading Limited (報價單號：BWF-OB26-001 R2)");
  assert.match(commercial.text, /感謝貴司（XYZ Trading Limited）/);
  assert.match(commercial.text, /收到訂金後預計 3–4 週完成生產/);
  assert.match(commercial.text, /須支付 70% 訂金於生產前，餘下 30% 於交付前付清/);

  const ngo = schoolSample({
    quoteId: "BWF-NGO26-077",
    version: "v1",
    clientName: "基督教勵行會 朗屏服務中心",
    clientIndustry: [],
  });
  assert.match(ngo.text, /感謝貴機構（基督教勵行會 朗屏服務中心）/);
  assert.match(ngo.text, /政府單位及非牟利機構可在確認訂單後安排生產/);
});

test("greets the contact person and leaves the company name out of the opening greeting", () => {
  assert.equal(
    quoteEmailAddressee("Angela Fung 基督教勵行會 朗屏服務中心", "基督教勵行會 朗屏服務中心"),
    "Angela Fung",
  );
  assert.equal(defaultQuoteEmailGreeting("曾先生", "zh-Hant"), "曾先生您好：");
  assert.equal(defaultQuoteEmailGreeting("Angela Fung", "zh-Hant"), "Dear Angela Fung,");

  const message = buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: "Q-1",
    customerName: "Angela Fung",
    clientName: "基督教勵行會 朗屏服務中心",
    itemCount: 1,
    totalAmount: 1000,
    shareUrl: SHARE_URL,
  });
  assert.match(message.text, /^Dear Angela Fung,/);
});

test("uses the follow-up wording for the 3-day reminder", () => {
  const message = schoolSample({ kind: "follow_up" });

  assert.equal(message.subject, "跟進：BW Furniture 學生枱凳報價單- 南元朗官立小學 (報價單號：BWF-SH26-126 R1)");
  assert.match(message.text, /謹此跟進早前為貴校（南元朗官立小學）準備的學生枱凳報價單/);
});

test("escapes customer-provided intro, highlights, and section text", () => {
  const message = schoolSample({
    customerName: "<b>Customer</b>",
    productHighlights: `<script>alert("hi")</script>`,
    introText: `<script>alert("intro")</script>`,
    customSections: [{ title: `<b>title</b>`, body: `<img src=x onerror=alert(1)>` }],
  });

  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /&lt;b&gt;Customer&lt;\/b&gt;您好：/);
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;hi&quot;\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;intro&quot;\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;b&gt;title&lt;\/b&gt;/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("omits the share link when the share url is missing", () => {
  const message = schoolSample({ shareUrl: "" });
  assert.doesNotMatch(message.html, /https:\/\/www\.bwteam-furniture\.com\/q\//);
  assert.doesNotMatch(message.html, /線上服務平台/);
});

test("localizes system copy in the selected language for manual and follow-up emails", () => {
  const simplified = schoolSample({ locale: "zh-Hans" });
  assert.match(simplified.html, /lang="zh-Hans"/);
  assert.match(simplified.subject, /报价单- 南元朗官立小學 \(报价单号：BWF-SH26-126 R1\)/);
  assert.match(simplified.text, /【产品规格及材质重点】/);
  assert.match(simplified.text, /【交付及付款安排】/);
  assert.match(simplified.html, /https:\/\/www\.bwteam-furniture\.com\/q\/6c851380/);
  assert.doesNotMatch(simplified.html, /前往线上服务平台浏览及修改/);

  const english = schoolSample({ locale: "en", kind: "follow_up", customerName: "" });
  assert.match(english.html, /lang="en"/);
  assert.match(english.subject, /^Follow-up: BW Furniture .* Quotation/);
  assert.match(english.text, /\[Product Specifications & Material Highlights\]/);
  assert.match(english.text, /\[Delivery & Payment Terms\]/);
  assert.match(english.html, /https:\/\/www\.bwteam-furniture\.com\/q\/6c851380/);
  assert.doesNotMatch(english.html, /View Quotation &amp; Request Changes Online/);
  assert.match(english.html, /Phone: /);
  assert.doesNotMatch(english.html, /Dear /);
});

test("uses the assigned PM footer with YouTube channel and escapes its content", () => {
  const footer = defaultPmQuoteEmailFooter("PM <Name>", " +852 1234 5678 ");
  const message = schoolSample({ locale: "en", kind: "follow_up", footer });
  assert.match(message.text, /PM <Name>\nmobile \+852 1234 5678\nBW Office Furniture \(since 2009\)\nYouTube 頻道\nhttps:\/\/www\.youtube\.com\/@bwoffice-furniture/);
  assert.match(message.html, /PM &lt;Name&gt;<br>mobile \+852 1234 5678/);
  assert.match(message.html, /href="https:\/\/www\.youtube\.com\/@bwoffice-furniture"/);
  assert.match(message.html, /href="https:\/\/bwoffice\.asia\/pages\/catalog"/);
  assert.match(message.html, /href="https:\/\/www\.bwoffice\.asia"/);
  assert.doesNotMatch(message.html, /This automated quotation is for reference/);
  assert.match(message.html, /sales@brandingworks-furniture\.com/);
  assert.match(schoolSample({ footer: null }).html, /此為系統發出的參考報價通知/);
});

test("splits a stored signature into name, phone and closing, then rebuilds the sent footer", () => {
  const stored = defaultPmQuoteEmailFooter("Rachel Zhu", "");
  const draft = quoteEmailSenderDraft({
    pm_name: "Rachel Zhu",
    sender_name: "",
    phone: "",
    body_zh_hant: stored["zh-Hant"],
    body_zh_hans: stored["zh-Hans"],
    body_en: stored.en,
  });
  assert.equal(draft.sender_name, "Rachel Zhu");
  assert.equal(draft.phone, "9717 3545 / 6263 4365");
  assert.match(draft.body_zh_hant, /^BW Office Furniture \(since 2009\)\nYouTube 頻道/);
  assert.doesNotMatch(draft.body_en, /^Rachel Zhu/);

  const sent = materializeQuoteEmailFooter({
    pm_name: "Rachel Zhu",
    sender_name: "Rachel Zhu",
    phone: draft.phone,
    body_zh_hant: draft.body_zh_hant,
    body_zh_hans: "公司簡介",
    body_en: draft.body_en,
  });
  assert.equal(sent.senderName, "Rachel Zhu");
  assert.match(sent.footer["zh-Hant"], /^Rachel Zhu\nmobile 9717 3545\ndirect 6263 4365\nBW Office Furniture/);
  assert.match(sent.footer["zh-Hans"], /^Rachel Zhu\nmobile 9717 3545\ndirect 6263 4365\n公司簡介/);
  assert.match(sent.footer.en, /^Rachel Zhu\nmobile 9717 3545\ndirect 6263 4365\n/);
  assert.equal(quoteEmailFromHeader("陳大文"), "陳大文 | BW Furniture <sale@bwteam-furniture.com>");
  assert.equal(quoteEmailFromHeader("Name <bad>"), "Name bad | BW Furniture <sale@bwteam-furniture.com>");
  assert.deepEqual(quoteEmailBccList("client@example.com", "sale@bwteam-furniture.com"), ["sale@bwteam-furniture.com"]);
  assert.deepEqual(quoteEmailBccList("sale@bwteam-furniture.com", "sale@bwteam-furniture.com"), []);
  assert.deepEqual(quoteEmailBccList("client@example.com", "  "), []);
});

test("upgrades unmodified legacy and previous default signatures while keeping custom ones", () => {
  const previousClosing = [
    "BW Office Furniture (since 2009)",
    "Our Latest Furniture Category PDF\nhttps://bwoffice.asia/pages/catalog",
    "Online Store:\nwww.bwfurnitures.com",
    "Brand Furniture:\nwww.bwoffice.asia",
  ].join("\n\n");

  const footer = refreshDefaultQuoteEmailFooter({
    "zh-Hant": "Rachel Zhu\n項目經理｜BW Furniture",
    "zh-Hans": "自訂簽名",
    en: previousClosing,
  });
  assert.match(footer["zh-Hant"], /^Rachel Zhu\nmobile 9717 3545\ndirect 6263 4365\nBW Office Furniture \(since 2009\)\nYouTube 頻道/);
  assert.equal(footer["zh-Hans"], "自訂簽名");
  assert.equal(footer.en, defaultQuoteEmailClosing());
});
