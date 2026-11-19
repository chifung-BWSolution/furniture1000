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
  assert.match(message.text, /Includes: Office desk, Office chair, Kosen Walnut Patterned Desk\./);
  assert.doesNotMatch(message.text, /辦公/);
});
