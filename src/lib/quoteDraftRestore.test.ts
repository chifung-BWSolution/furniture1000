import assert from "node:assert/strict";
import {
  mergeClientFields,
  mergeDefaultableText,
  mergeDeliveryAddress,
  mergeGpSummary,
  mergeInstallationAmount,
  mergePriceMultiplier,
  mergeStringList,
  mergeTextField,
  preferSavedIfDraftEmpty,
  termsMatchIgnoringAddress,
} from "./quoteDraftRestore.ts";

const savedAddress = "九龍長沙灣順寧道323號曦華樓";
const legacy = false;

assert.equal(
  mergeDeliveryAddress({
    draftMetaAddress: "",
    draftTermsAddress: "",
    draftTermsEnAddress: "",
    savedAddress,
    blankFieldsAreIntentional: legacy,
  }),
  savedAddress,
);
assert.equal(
  mergeDeliveryAddress({
    draftMetaAddress: "新地址",
    draftTermsAddress: "",
    draftTermsEnAddress: "",
    savedAddress,
    blankFieldsAreIntentional: legacy,
  }),
  "新地址",
);
assert.equal(
  mergeDeliveryAddress({
    draftMetaAddress: "  ",
    draftTermsAddress: "",
    draftTermsEnAddress: "",
    savedAddress,
    blankFieldsAreIntentional: true,
  }),
  "",
);

assert.equal(mergeInstallationAmount(null, 1200, false), 1200);
assert.equal(mergeInstallationAmount(undefined, 1200, false), 1200);
assert.equal(mergeInstallationAmount(null, 1200, true), null);
assert.equal(mergeInstallationAmount(0, 1200, false), 0);

assert.deepEqual(
  mergeClientFields(
    { name: "", contactName: "", phone: "", email: "" },
    { name: "救世軍", contactName: "楊生", phone: "5303 2435", email: "client@example.com" },
    legacy,
  ),
  { name: "救世軍", contactName: "楊生", phone: "5303 2435", email: "client@example.com" },
);
assert.equal(
  mergeClientFields(
    { phone: "" },
    { name: "救世軍", contactName: "楊生", phone: "5303 2435", email: "client@example.com" },
    true,
  ).phone,
  "",
);

assert.deepEqual(mergeGpSummary({ ship: 0, installation: 0 }, { ship: 600, installation: 800 }, legacy), {
  ship: 600,
  installation: 800,
});
assert.deepEqual(mergeGpSummary({ ship: 0, installation: 0 }, { ship: 600, installation: 800 }, true), {
  ship: 0,
  installation: 0,
});
assert.deepEqual(mergeGpSummary({ ship: 100, installation: 0 }, { ship: 600, installation: 800 }, legacy), {
  ship: 100,
  installation: 0,
});

const factoryLeadTime =
  "訂單生產時間自收到訂金起計算，預計3-4 週完成。交付及安裝將分兩日進行：交付後1-2 個工作日內完成安裝。";
const savedLeadTime =
  "訂單生產時間自收到訂金起計算，預計2-3週完成。交付及安裝將分兩日進行：交付後1-2 個工作日內完成安裝。";
assert.equal(
  mergeDefaultableText(factoryLeadTime, savedLeadTime, factoryLeadTime, legacy),
  savedLeadTime,
);
assert.equal(
  mergeDefaultableText("自訂交貨期", savedLeadTime, factoryLeadTime, legacy),
  "自訂交貨期",
);

assert.deepEqual(mergeStringList([], ["非政府組織"], legacy), ["非政府組織"]);
assert.deepEqual(mergeStringList([], ["非政府組織"], true), []);
assert.equal(mergeTextField("", "備註", legacy), "備註");
assert.equal(mergeTextField("", "備註", true), "");
assert.equal(mergePriceMultiplier(1, "2.3", legacy), null);
assert.equal(mergePriceMultiplier(1, "2.3", true), "1");
assert.equal(mergePriceMultiplier("2.3", "1", legacy), "2.3");

assert.deepEqual(
  preferSavedIfDraftEmpty([], ["photo"], (rows) => rows.length === 0, legacy),
  ["photo"],
);
assert.equal(termsMatchIgnoringAddress("<p>條款<u>九龍</u></p>", "<p>條款<u></u></p>"), true);
assert.equal(termsMatchIgnoringAddress("<p>條款已改<u>九龍</u></p>", "<p>條款<u></u></p>"), false);

console.log("quote draft restore ok");
