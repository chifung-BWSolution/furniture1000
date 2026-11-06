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
  assert.match(message.html, /客戶已在報價頁面提交報價選擇，請確認後處理正式報價。/);
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

test("labels additions and replacements in the change email", () => {
  const message = build({
    requestType: "change",
    quoteVersion: "v2",
    lines: [
      { name: "會議枱", quantity: 2, selected: true, unit: "件", kind: "addition" },
      {
        name: "大班椅",
        quantity: 1,
        selected: true,
        unit: "件",
        kind: "replacement",
        originalName: "員工椅",
      },
    ],
  });

  assert.equal(message.subject, `客戶提交加選／換款變更：${QUOTE_ID} v2`);
  assert.match(message.html, />加選</);
  assert.match(message.html, />換款</);
  assert.match(message.html, /原項目：員工椅/);
  assert.match(message.text, /- \[加選\] 會議枱 × 2 件/);
  assert.match(message.text, /- \[換款\] 員工椅 → 大班椅 × 1 件/);
  assert.match(message.html, /報價版本/);
});

test("renders a confirmation receipt without line items", () => {
  const message = build({
    requestType: "confirm",
    quoteVersion: "v3",
    lines: [],
    totalCents: 0,
  });

  assert.equal(message.subject, `客戶確認報價版本：${QUOTE_ID} v3`);
  assert.match(message.html, /客戶已就這個報價版本作出決定，沒有附加項目。/);
  assert.doesNotMatch(message.html, /選品合計/);
  assert.match(message.text, /- 客戶已就這個報價版本作出決定。/);
});

test("renders a rejection receipt", () => {
  const message = build({
    requestType: "reject",
    quoteVersion: "v4",
    lines: [],
    totalCents: 0,
  });

  assert.equal(message.subject, `客戶不接受報價版本：${QUOTE_ID} v4`);
  assert.match(message.html, /客戶已就這個報價版本作出決定，沒有附加項目。/);
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
