import assert from "node:assert/strict";
import test from "node:test";

import { buildQuoteCustomerEmail } from "../_shared/quoteCustomerEmail.ts";

const QUOTE_ID = "FDS15-SEND-TEST-17932533188893";
const SHARE_URL = "https://www.bwteam-furniture.com/customer?quote_share=test-token";

function manual(overrides = {}) {
  return buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: QUOTE_ID,
    introText: "這是 FDS 發信測試，收到請回覆。",
    contactPhone: "+852 9000 0000",
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
  assert.match(plainHtml, /\+852 9000 0000/);
  assert.match(message.html, /https:\/\/www\.bwteam-furniture\.com\/customer\?quote_share=test-token/);
  assert.match(message.html, /送貨安排/);
  assert.match(plainHtml, /Room D-G, 5\/F, Wah Lik Industrial Centre/);
  assert.match(plainHtml, /sales@brandingworks-furniture\.com/);
  assert.match(message.text, /請用這個連結提交：https:\/\/www\.bwteam-furniture\.com/);
});

test("uses the follow-up wording for the 3-day reminder", () => {
  const message = manual({ kind: "follow_up" });

  assert.equal(message.subject, `跟進：${QUOTE_ID}（可隨時加單或改數量）`);
  assert.match(message.html, /跟進：您的傢俬方案/);
  assert.match(message.html, /查看最新報價/);
});

test("escapes customer-provided intro and section text", () => {
  const message = manual({
    introText: `<script>alert("intro")</script>`,
    customSections: [{ title: `<b>title</b>`, body: `<img src=x onerror=alert(1)>` }],
  });

  assert.doesNotMatch(message.html, /<script>/);
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;intro&quot;\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;b&gt;title&lt;\/b&gt;/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("omits the CTA when the share link is missing", () => {
  const message = manual({ shareUrl: "" });
  assert.doesNotMatch(message.html, /查看報價及加單/);
  assert.doesNotMatch(message.html, /quote_share=/);
});
