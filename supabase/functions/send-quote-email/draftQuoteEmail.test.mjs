import assert from "node:assert/strict";
import test from "node:test";

import { draftQuoteEmailWithAi } from "../_shared/draftQuoteEmail.ts";

const ITEMS = [
  {
    name: "學生枱",
    quantity: 140,
    unit: "張",
    dimensionLMm: "620",
    dimensionWMm: "450",
    dimensionHMm: "750",
    material: "<p>1、 桌子高度可調節為 750/720/690 三個檔位</p><p>2、桌子立柱採用厚度為 1.2 毫米的優質冷軋鋼管</p><p>3、檯面採用ABS注塑工藝</p>",
  },
  {
    name: "學生膠凳",
    quantity: 140,
    unit: "張",
    dimensionLMm: "420",
    dimensionWMm: "470",
    dimensionHMm: "735",
    material: "<p>1、全新工程聚丙PP材質</p>",
  },
  {
    name: "安裝及運費",
    quantity: 1,
    unit: "項",
  },
];

test("draftQuoteEmailWithAi returns AI-polished productTitle and highlights via Gemini", async () => {
  const previous = globalThis.Deno;
  globalThis.Deno = {
    env: {
      get(name) {
        return name === "GEMINI_API_KEY" ? "test-gemini-key" : "";
      },
    },
  };
  try {
    const result = await draftQuoteEmailWithAi(
      { items: ITEMS, clientName: "南元朗官立小學", locale: "zh-Hant" },
      async (url, init) => {
        assert.match(String(url), /generativelanguage\.googleapis\.com/);
        const body = JSON.parse(init.body);
        assert.doesNotMatch(body.contents[0].parts[0].text, /安裝及運費/);
        return new Response(JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  productTitle: "學生枱凳",
                  productHighlights:
                    "1. 學生枱（140 張）：尺寸 W620 x D450 x H750 mm。設有 750 / 720 / 690 mm 三檔高度調節。\n2. 學生膠凳（140 張）：尺寸 W420 x D470 x H735 mm。採用全新工程聚丙（PP）材質製造。",
                }),
              }],
            },
          }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    );
    assert.equal(result.source, "ai");
    assert.equal(result.productTitle, "學生枱凳");
    assert.match(result.productHighlights, /1\. 學生枱（140 張）/);
    assert.match(result.productHighlights, /2\. 學生膠凳（140 張）/);
  } finally {
    globalThis.Deno = previous;
  }
});

test("draftQuoteEmailWithAi falls back deterministically when AI fails", async () => {
  const previous = globalThis.Deno;
  globalThis.Deno = {
    env: {
      get(name) {
        return name === "GEMINI_API_KEY" ? "test-gemini-key" : "";
      },
    },
  };
  try {
    const result = await draftQuoteEmailWithAi(
      { items: ITEMS, clientName: "南元朗官立小學", locale: "zh-Hant" },
      async () => new Response("rate limited", { status: 429 }),
    );
    assert.equal(result.source, "fallback");
    assert.equal(result.productTitle, "學生枱及學生膠凳");
    assert.match(result.productHighlights, /1\. 學生枱（140 張）：尺寸 W620 x D450 x H750 mm/);
    assert.match(result.productHighlights, /2\. 學生膠凳（140 張）：尺寸 W420 x D470 x H735 mm/);
    assert.doesNotMatch(result.productHighlights, /安裝及運費/);
  } finally {
    globalThis.Deno = previous;
  }
});
