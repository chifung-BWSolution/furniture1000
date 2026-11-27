import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultProductHighlights, buildQuoteCustomerEmail } from "../_shared/quoteCustomerEmail.ts";
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

test("english email highlights list the localized furniture names", () => {
  const message = buildQuoteCustomerEmail({
    kind: "manual",
    quoteId: "Q-1",
    locale: "en",
    itemCount: 3,
    totalAmount: 188918,
    sampleItems: "Office desk, Office chair, Kosen Walnut Patterned Desk",
    shareUrl: "https://www.bwteam-furniture.com/customer?quote_share=test",
  });
  assert.match(message.text, /1\. Office desk/);
  assert.match(message.text, /2\. Office chair/);
  assert.match(message.text, /3\. Kosen Walnut Patterned Desk/);
  assert.doesNotMatch(message.text, /辦公/);
});

test("builds deterministic product highlights for up to 15 furniture items and notes remainder", () => {
  const items = Array.from({ length: 17 }, (_, index) => ({
    name: `椅子 ${index + 1}`,
    quantity: index + 1,
    unit: "張",
    dimensionLMm: "500",
    dimensionWMm: "520",
    dimensionHMm: "800",
    material: "<p>1. 網布靠背</p>",
  }));
  const highlights = buildDefaultProductHighlights(items, null, "zh-Hant");
  assert.match(highlights, /15\. 椅子 15（15 張）：尺寸 W500 x D520 x H800 mm。網布靠背。/);
  assert.doesNotMatch(highlights, /16\. 椅子 16/);
  assert.match(highlights, /另附其餘 2 項產品/);
});
