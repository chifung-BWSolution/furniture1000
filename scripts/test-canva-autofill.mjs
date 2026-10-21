import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const context = {
  exports: {},
  URL,
  Deno: { env: { get: () => undefined } },
};
vm.createContext(context);
vm.runInContext(ts.transpileModule(
  fs.readFileSync(new URL('../supabase/functions/generate-canva-presentation/autofill.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, context);

const {
  PRODUCT_SELECT_COLUMNS,
  buildAutofillPayload,
  createDatasetMatcher,
  productImageFieldNeeds,
  productSlotCount,
  unmatchedBrandTemplateMessage,
} = context.exports;

const uiContext = { exports: {} };
vm.createContext(uiContext);
vm.runInContext(ts.transpileModule(
  fs.readFileSync(new URL('../src/lib/canvaBrandTemplate.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, uiContext);
const { canvaAutofillNotices } = uiContext.exports;

const failures = [];
const check = (name, run) => {
  try { run(); console.log(`PASS: ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL: ${name}: ${error.message}`); }
};

const product = {
  id: 'p1',
  title: '會議椅',
  model: 'HZ-1',
  sku: null,
  image_url: 'https://cdn.example.com/chair.jpg',
  image_url_2: null,
  image_url_3: null,
  sale_price: 1280,
  price: 1600,
  material: '橡木',
  color: null,
  dimension_l_mm: 800,
  dimension_w_mm: 600,
  dimension_h_mm: 750,
  level1_category: null,
  level2_category: null,
  factories_display_name: '華座',
};

check('product select uses real columns', () => {
  assert.equal(PRODUCT_SELECT_COLUMNS.includes('middle_price'), false);
  assert.equal(PRODUCT_SELECT_COLUMNS.includes('size_l'), false);
  assert.equal(PRODUCT_SELECT_COLUMNS.includes('factory,'), false);
  assert.equal(PRODUCT_SELECT_COLUMNS.endsWith('factory'), false);
  for (const column of ['sale_price', 'price', 'dimension_l_mm', 'dimension_w_mm', 'dimension_h_mm', 'factories_display_name']) {
    assert.equal(PRODUCT_SELECT_COLUMNS.split(',').includes(column), true, column);
  }
});

check('exact FDS field names are filled', () => {
  const matcher = createDatasetMatcher(['FDS_COVER_TITLE', 'FDS_PROD_01_TITLE', 'FDS_PROD_01_DETAILS']);
  const { data } = buildAutofillPayload({ title: '客戶提案' }, [product], matcher);
  assert.equal(data.FDS_COVER_TITLE.text, '客戶提案');
  assert.equal(data.FDS_PROD_01_TITLE.text, '會議椅');
  assert.match(data.FDS_PROD_01_DETAILS.text, /800 × 600 × 750 mm/);
  assert.match(data.FDS_PROD_01_DETAILS.text, /華座/);
  assert.match(data.FDS_PROD_01_DETAILS.text, /HK\$/);
});

check('field match is case-insensitive and accepts aliases', () => {
  const matcher = createDatasetMatcher(['fds-cover-title', 'cover_title', 'product_01_title']);
  const { data, report } = buildAutofillPayload({ title: '封面' }, [product], matcher);
  assert.equal(data['fds-cover-title'].text, '封面');
  assert.equal(data.cover_title, undefined);
  assert.equal(data.product_01_title.text, '會議椅');
  assert.equal(JSON.stringify(report.fields_sent), JSON.stringify(['fds-cover-title', 'product_01_title']));
});

check('bare title is the cover field and is not reused as a product title', () => {
  const matcher = createDatasetMatcher(['title']);
  const { data } = buildAutofillPayload({ title: '封面' }, [product], matcher);
  assert.equal(JSON.stringify(Object.keys(data)), JSON.stringify(['title']));
  assert.equal(data.title.text, '封面');
});

check('unmatched template fields produce an empty payload and a Chinese field list', () => {
  const templateFields = ['Headline', 'Body copy'];
  const matcher = createDatasetMatcher(templateFields);
  const { data } = buildAutofillPayload({ title: '封面', outline: '大綱' }, [product], matcher);
  assert.equal(JSON.stringify(data), '{}');
  const message = unmatchedBrandTemplateMessage(matcher.keys());
  assert.match(message, /FDS_COVER_TITLE/);
  assert.match(message, /FDS_PROD_01_TITLE/);
  assert.match(message, /Headline/);
  assert.match(message, /Body copy/);
  assert.match(message, /已停止呼叫 Canva/);
});

function numberedProduct(n) {
  return { ...product, id: `p${n}`, title: `產品${n}` };
}

check('slot count is the highest product index in the dataset', () => {
  assert.equal(productSlotCount(['FDS_PROD_01_TITLE', 'fds-prod-03-image', 'FDS_COVER_TITLE']), 3);
  assert.equal(productSlotCount(['product_08_title', 'product_2_details']), 8);
  assert.equal(productSlotCount(['title', 'outline']), 0);
});

check('extra products fill only the first slots and warn', () => {
  const keys = ['FDS_PROD_01_TITLE', 'FDS_PROD_02_TITLE', 'FDS_PROD_03_DETAILS'];
  const products = [1, 2, 3, 4, 5].map(numberedProduct);
  const { data, report } = buildAutofillPayload({ title: '封面' }, products, createDatasetMatcher(keys));
  assert.equal(data.FDS_PROD_01_TITLE.text, '產品1');
  assert.equal(data.FDS_PROD_02_TITLE.text, '產品2');
  assert.equal(data.FDS_PROD_03_TITLE, undefined);
  assert.equal(report.product_slot_count, 3);
  assert.equal(report.products_included, 3);
  assert.equal(JSON.stringify(report.unused_slots), '[]');
  const warning = report.warnings.find((item) => item && item.code === 'products_truncated');
  assert.equal(warning.slot_count, 3);
  assert.equal(warning.selected, 5);
});

check('unused slot numbers are the blank product pages', () => {
  const keys = ['FDS_PROD_01_TITLE', 'FDS_PROD_04_IMAGE'];
  const { report } = buildAutofillPayload({ title: '封面' }, [numberedProduct(1)], createDatasetMatcher(keys));
  assert.equal(report.product_slot_count, 4);
  assert.equal(JSON.stringify(report.unused_slots), JSON.stringify([2, 3, 4]));
  assert.equal(report.warnings.some((item) => item && item.code === 'products_truncated'), false);
});

check('frontend describes truncation and blank pages in Chinese', () => {
  const truncated = canvaAutofillNotices({
    warnings: [{ code: 'products_truncated', slot_count: 3, selected: 5 }],
    unused_slots: [],
  });
  assert.equal(truncated[0], '已選 5 件產品，模板只有 3 個產品欄位，已填入前 3 件。');
  const blank = canvaAutofillNotices({ warnings: [], unused_slots: [2, 3, 4] });
  assert.equal(blank[0], '第 2 至 4 個產品頁是空白，可在 Canva 刪除。');
});

check('image fields resolve to the template key', () => {
  const matcher = createDatasetMatcher(['product_1_image']);
  const needs = productImageFieldNeeds([product], matcher);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].field, 'product_1_image');
  const blocked = productImageFieldNeeds([{ ...product, image_url: 'https://127.0.0.1/secret.jpg' }], createDatasetMatcher(['product_1_image']));
  assert.equal(blocked.length, 0);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall canva autofill checks passed');
