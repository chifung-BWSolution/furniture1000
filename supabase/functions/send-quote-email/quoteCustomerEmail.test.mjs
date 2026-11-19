import assert from "node:assert/strict";
import test from "node:test";

import { defaultPmQuoteEmailFooter, materializeQuoteEmailFooter, quoteEmailBccList, quoteEmailFromHeader, quoteEmailSenderDraft, refreshDefaultQuoteEmailFooter } from "../_shared/quoteEmailFooter.ts";
import { buildQuoteCustomerEmail } from "../_shared/quoteCustomerEmail.ts";

const QUOTE_ID = "FDS15-SEND-TEST-17932533188893";
const SHARE_URL = "https://www.bwteam-furniture.com/customer?quote_share=test-token";

function manual(overrides = {}) {
  return buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: QUOTE_ID,
    introText: "這是 FDS 發信測試，收到請回覆。",
    customerName: "陳小姐",
    customSections: [{ title: "送貨安排", body: "星期一至五\n09:00-18:00" }],
    itemCount: 1,
    totalAmount: 1600,
    sampleItems: "員工椅",
    shareUrl: SHARE_URL,
    ...overrides,
  });
}

test("renders the branded customer quote email with CTA and company footer", () => {
  const message = manual();
  const plainHtml = message.html.replace(/<[^>]*>/g, "");

  assert.equal(message.subject, `${QUOTE_ID} 報價及加單連結`);
  assert.match(message.html, /您的傢俬方案報價/);
  assert.match(plainHtml, /共 1 項傢俬。/);
  assert.match(plainHtml, /包括：員工椅。/);
  assert.match(plainHtml, /參考總額 HK\$ 1,600\.00。/);
  assert.match(plainHtml, /Dear 陳小姐,/);
  assert.match(message.text, /^Dear 陳小姐,/);
  assert.doesNotMatch(plainHtml, /與負責同事聯絡/);
  assert.match(message.html, /網上查看報價及修改需求/);
  assert.match(message.html, /https:\/\/www\.bwteam-furniture\.com\/customer\?quote_share=test-token/);
  assert.match(message.html, /送貨安排/);
  assert.match(plainHtml, /Room D-G, 5\/F, Wah Lik Industrial Centre/);
  assert.match(plainHtml, /sales@brandingworks-furniture\.com/);
  assert.match(message.text, /網上查看報價及修改需求: https:\/\/www\.bwteam-furniture\.com/);
});

test("uses the follow-up wording for the 3-day reminder", () => {
  const message = manual({ kind: "follow_up" });

  assert.equal(message.subject, `跟進：${QUOTE_ID}（可隨時加單或改數量）`);
  assert.match(message.html, /跟進：您的傢俬方案/);
  assert.match(message.html, /網上查看報價及修改需求/);
});

test("escapes customer-provided intro and section text", () => {
  const message = manual({
    customerName: "<b>Customer</b>",
    introText: `<script>alert("intro")</script>`,
    customSections: [{ title: `<b>title</b>`, body: `<img src=x onerror=alert(1)>` }],
  });

  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /Dear &lt;b&gt;Customer&lt;\/b&gt;,/);
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;intro&quot;\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;b&gt;title&lt;\/b&gt;/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("omits the CTA when the share link is missing", () => {
  const message = manual({ shareUrl: "" });
  assert.doesNotMatch(message.html, /網上查看報價及修改需求/);
  assert.doesNotMatch(message.html, /quote_share=/);
});

test("localizes system copy in the selected language for manual and follow-up emails", () => {
  const simplified = manual({ locale: "zh-Hans" });
  assert.match(simplified.html, /lang="zh-Hans"/);
  assert.match(simplified.subject, /报价及加单链接/);
  assert.match(simplified.text, /共 1 项家具。/);
  assert.match(simplified.html, /网上查看报价及修改需求/);

  const english = manual({ locale: "en", kind: "follow_up", customerName: "" });
  assert.match(english.html, /lang="en"/);
  assert.match(english.subject, /^Follow-up:/);
  assert.match(english.text, /1 furniture item\./);
  assert.match(english.html, /View quotation and request changes online/);
  assert.match(english.html, /Phone: /);
  assert.doesNotMatch(english.html, /Dear /);
});


test("uses the assigned PM footer in the chosen language and escapes its content", () => {
  const footer = defaultPmQuoteEmailFooter("PM <Name>", " +852 1234 5678 ");
  const message = manual({ locale: "en", kind: "follow_up", footer });
  assert.match(message.text, /PM <Name>\nmobile \+852 1234 5678\nBW Office Furniture \(since 2009\)/);
  assert.match(message.html, /PM &lt;Name&gt;<br>mobile \+852 1234 5678/);
  assert.match(message.html, /href="https:\/\/bwoffice\.asia\/pages\/catalog"/);
  assert.match(message.html, /href="https:\/\/www\.bwfurnitures\.com"/);
  assert.match(message.html, /href="https:\/\/www\.bwoffice\.asia"/);
  assert.doesNotMatch(message.html, /This automated quotation is for reference/);
  assert.match(message.html, /sales@brandingworks-furniture\.com/);
  assert.match(manual({ locale: "zh-Hans", footer }).html, /BW Office Furniture \(since 2009\)/);
  assert.match(manual().html, /此為系統發出的參考報價通知/);
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
  assert.match(draft.body_zh_hant, /^BW Office Furniture \(since 2009\)/);
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

test("uses the existing BWF phone mapping and updates only default signatures", () => {
  const footer = refreshDefaultQuoteEmailFooter({
    "zh-Hant": "Rachel Zhu\n項目經理｜BW Furniture",
    "zh-Hans": "自訂簽名",
    en: "Rachel Zhu\nProject Manager | BW Furniture",
  });
  assert.match(footer.en, /^Rachel Zhu\nmobile 9717 3545\ndirect 6263 4365\n/);
  assert.equal(footer["zh-Hant"], footer.en);
  assert.equal(footer["zh-Hans"], "自訂簽名");
});
