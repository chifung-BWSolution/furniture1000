import assert from "node:assert/strict";
import test from "node:test";

import { buildQuoteCustomerEmail } from "../_shared/quoteCustomerEmail.ts";
import {
  englishNameInSample,
  localizeEnglishSampleItems,
} from "../_shared/quoteSampleItems.ts";

const STORED = "辦公枱、辦公椅、柯森胡桃拼紋老闆台 Kosen Walnut Patterned Desk、高背扶手大班椅 High-Back Executive Chair with Armrests、深木色防火板帶燈帶玻璃掩門文件櫃 Dark Wood MFC Glass Door File Cabinet";

test("uses the stored English name and translates Chinese-only furniture names", async () => {
  const seen = [];
  const sample = await localizeEnglishSampleItems(STORED, async (names) => {
    seen.push(...names);
    return names.map((name) => ({ "辦公枱": "Office desk.", "辦公椅": "Office chair" })[name]);
  });

  assert.deepEqual(seen, ["辦公枱", "辦公椅"]);
  assert.equal(
    sample,
    "Office desk, Office chair, Kosen Walnut Patterned Desk, High-Back Executive Chair with Armrests, Dark Wood MFC Glass Door File Cabinet",
  );
});

test("does not treat a single trailing English word as the product name", () => {
  assert.equal(englishNameInSample("辦公椅 Mesh"), null);
  assert.equal(englishNameInSample("Office chair"), "Office chair");
});

test("english email summary prints the localized furniture names", () => {
  const message = buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: "Q-1",
    locale: "en",
    itemCount: 11,
    totalAmount: 188918,
    sampleItems: "Office desk, Office chair, Kosen Walnut Patterned Desk",
    shareUrl: "https://www.bwteam-furniture.com/customer?quote_share=test",
  });
  assert.match(message.text, /11 furniture items\./);
  assert.match(message.text, /Office desk/);
  assert.match(message.text, /8 more items\. See the quotation online/);
  assert.doesNotMatch(message.text, /辦公/);
  assert.doesNotMatch(message.html, /Includes:/);
});

test("shows five furniture rows with pictures and keeps the rest as a count", () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    name: `椅子 ${index + 1}`,
    image: index === 0 ? "https://cdn.example.com/chair.jpg" : "data:image/png;base64,abc",
    quantity: index + 1,
    unit: "張",
    unitPrice: 100,
  }));
  const message = buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: "Q-1",
    itemCount: 7,
    totalAmount: 2800,
    previewItems: items,
    shareUrl: "https://www.bwteam-furniture.com/customer?quote_share=test",
  });
  assert.match(message.html, />椅子 5<\/td>/);
  assert.doesNotMatch(message.html, /椅子 6/);
  assert.match(message.html, /src="https:\/\/cdn\.example\.com\/chair\.jpg"/);
  assert.doesNotMatch(message.html, /data:image/);
  assert.match(message.html, /另外還有 2 項/);
  assert.match(message.text, /椅子 1 · 1 張 · HK\$ 100\.00/);
  assert.doesNotMatch(message.text, /椅子 6/);
});
