import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/quotationDefaultTerms.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
vm.runInNewContext(outputText, {
  exports,
  require: () => ({ normalizeQuotationPdfGlyphs: (text) => text }),
});
const {
  buildDefaultTermsFullHtml,
  extractDeliveryAddressFromTermsHtml,
  injectDeliveryAddressIntoTermsHtml,
  migrateTermsContentToCurrent,
  QUOTATION_TERMS_TEMPLATE_VERSION,
  readDeliveryAddressLine,
} = exports;

const unrelated = '<p><u>Payment Terms</u></p>';
const addressLine = (label, address) => `<p><strong>1&nbsp;${label} :</strong>&nbsp;<u>${address}</u></p>`;

test('address extraction ignores unrelated underlines', () => {
  assert.equal(extractDeliveryAddressFromTermsHtml(unrelated + addressLine('送貨地址', '&nbsp;')), '');
  assert.equal(readDeliveryAddressLine(unrelated), undefined);
});

test('reopening uses the saved quotation address over an older address in the terms', () => {
  const fullHtml = injectDeliveryAddressIntoTermsHtml(buildDefaultTermsFullHtml(), 'Old address') + unrelated;
  const restored = migrateTermsContentToCurrent({
    fullHtml,
    templateVersion: QUOTATION_TERMS_TEMPLATE_VERSION,
  }, 'New address');
  assert.equal(extractDeliveryAddressFromTermsHtml(restored.fullHtml), 'New address');
  assert.ok(restored.fullHtml.endsWith(unrelated));
});

test('English and Chinese terms can update and clear the specific address line', () => {
  for (const label of ['送貨地址', 'Delivery Address']) {
    const html = unrelated + addressLine(label, 'Old address');
    const updated = injectDeliveryAddressIntoTermsHtml(html, 'A & B\nFloor 2');
    assert.ok(updated.startsWith(unrelated));
    assert.equal(extractDeliveryAddressFromTermsHtml(updated), 'A & B\nFloor 2');
    const cleared = injectDeliveryAddressIntoTermsHtml(updated, '');
    assert.ok(cleared.startsWith(unrelated));
    assert.equal(extractDeliveryAddressFromTermsHtml(cleared), '');
  }
});
