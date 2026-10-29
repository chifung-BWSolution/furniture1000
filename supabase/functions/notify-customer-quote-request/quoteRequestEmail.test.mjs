import assert from "node:assert/strict";
import test from "node:test";

import { buildQuoteRequestEmail } from "../_shared/quoteRequestEmail.ts";

const QUOTE_ID = "FDS14-PM-TEST-1793253834732-A";
const QUOTE_URL = `https://www.bwteam-furniture.com/quote/${QUOTE_ID}`;

function build(overrides = {}) {
  return buildQuoteRequestEmail({
    quoteId: QUOTE_ID,
    lines: [
      { name: "員工椅", quantity: 3, selected: true, unit: "PC", note: "想換淺色" },
      { name: "未勾選項目", quantity: 1, selected: false, unit: "PC" },
    ],
    note: "客戶提交測試（PM 通知）",
    totalCents: 240000,
    pmName: "FDS 測試",
    quoteUrl: QUOTE_URL,
    ...overrides,
  });
}

test("renders the branded PM submission email with selected lines and CTA", () => {
  const message = build();

  assert.equal(message.subject, `客戶提交報價選擇：${QUOTE_ID}`);
  assert.match(message.html, /客戶已提交報價選擇/);
  assert.match(message.html, /客戶已在報價頁面提交選擇，請確認後處理正式報價。/);
  assert.match(message.html, /員工椅/);
  assert.match(message.html, /想換淺色/);
  assert.doesNotMatch(message.html, /未勾選項目/);
  assert.match(message.html, /HK\$ 2,400\.00/);
  assert.match(message.html, /客戶需求：/);
  assert.match(message.html, /FDS 測試/);
  assert.match(message.html, new RegExp(QUOTE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(message.html, /Room D-G, 5\/F, Wah Lik Industrial Centre/);
  assert.match(message.text, /- 員工椅 × 3 PC（想換淺色）/);
});

test("renders the no-selection fallback", () => {
  const message = build({ lines: [] });
  assert.match(message.html, /客戶沒有勾選項目，只留下需求說明。/);
  assert.match(message.text, /- 客戶沒有勾選項目，只留下需求說明。/);
});

test("escapes line names and customer notes", () => {
  const message = build({
    lines: [{ name: `<script>alert("line")</script>`, quantity: 1, selected: true }],
    note: `<img src=x onerror=alert(2)>`,
    pmName: `<b>pm</b>`,
  });

  assert.doesNotMatch(message.html, /<script>/);
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;script&gt;alert\(&quot;line&quot;\)&lt;\/script&gt;/);
  assert.match(message.html, /&lt;img src=x onerror=alert\(2\)&gt;/);
  assert.match(message.html, /&lt;b&gt;pm&lt;\/b&gt;/);
});
