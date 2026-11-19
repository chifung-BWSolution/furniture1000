import assert from "node:assert/strict";
import test from "node:test";

import { translateQuoteEmail } from "../_shared/translateQuoteEmail.ts";

test("translates furniture names with Gemini when Google Translation is not configured", async () => {
  const previous = globalThis.Deno;
  globalThis.Deno = {
    env: {
      get(name) {
        return name === "GEMINI_API_KEY" ? "test-gemini-key" : "";
      },
    },
  };
  try {
    const seen = [];
    const translated = await translateQuoteEmail(["辦公枱", "辦公椅"], "en", "", async (url, init) => {
      seen.push(String(url));
      assert.match(String(url), /generativelanguage\.googleapis\.com/);
      assert.doesNotMatch(String(url), /translation\.googleapis\.com/);
      const body = JSON.parse(init.body);
      assert.match(body.contents[0].parts[0].text, /辦公枱/);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '["Office desk","Office chair"]' }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    assert.deepEqual(translated, ["Office desk", "Office chair"]);
    assert.equal(seen.length, 1);
  } finally {
    globalThis.Deno = previous;
  }
});
