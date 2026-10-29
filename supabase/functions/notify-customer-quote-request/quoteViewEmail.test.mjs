import assert from "node:assert/strict";
import test from "node:test";

import { buildQuoteViewEmail, formatHongKongTime } from "../_shared/quoteViewEmail.ts";

const QUOTE_ID = "FDS14-PM-TEST-1793253834732-B";
const VIEWED_AT = "2026-10-28T22:04:00Z";
const LOGO_URL = "https://www.bwteam-furniture.com/assets/bwf-logo.png";

test("formats the view time in Hong Kong time", () => {
  assert.equal(formatHongKongTime(VIEWED_AT), "2026-10-29 06:04 (GMT+8)");
  assert.equal(formatHongKongTime("2026-01-01T16:00:00Z"), "2026-01-02 00:00 (GMT+8)");
  assert.equal(formatHongKongTime("not-a-date"), "not-a-date");
});

test("renders the branded quote-view email with logo and company footer", () => {
  const message = buildQuoteViewEmail({
    quoteId: QUOTE_ID,
    viewedAtIso: VIEWED_AT,
  });
  const plainHtml = message.html.replace(/<wbr>/g, "");

  assert.equal(message.subject, `客戶已查看報價：${QUOTE_ID}`);
  assert.match(message.html, /客戶已查看報價/);
  assert.match(message.html, /您的報價單已被客戶開啟，系統已自動停用該報價的進度提醒。/);
  assert.match(plainHtml, new RegExp(QUOTE_ID));
  assert.match(plainHtml, /2026-10-29 06:04 \(GMT\+8\)/);
  assert.match(plainHtml, new RegExp(LOGO_URL.replace(/\./g, "\\.")));
  assert.match(plainHtml, /Room D-G, 5\/F, Wah Lik Industrial Centre/);
  assert.match(plainHtml, /459-469 Castle Peak Road/);
  assert.match(plainHtml, /Tsuen Wan, Hong Kong/);
  assert.match(plainHtml, /電話：\(\+852\) 2127 4839/);
  assert.match(plainHtml, /手機 WhatsApp: \(\+852\) 9717 3545/);
  assert.match(plainHtml, /sales@brandingworks-furniture\.com/);
  assert.match(plainHtml, /此為系統自動發送的通知郵件，請勿回覆。/);
});

test("escapes quote ids before injecting them into HTML", () => {
  const message = buildQuoteViewEmail({
    quoteId: `<script>alert("x")</script>`,
    viewedAtIso: VIEWED_AT,
  });
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(message.text, /報價編號：<script>alert\("x"\)<\/script>/);
});
