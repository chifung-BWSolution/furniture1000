import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../supabase/functions/generate-canva-presentation/generation.ts', import.meta.url), 'utf8');
const context = { exports: {}, console };
vm.createContext(context);
vm.runInContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  context,
);
const g = context.exports;

const columns = g.PRODUCT_SELECT_COLUMNS.split(',');
for (const name of ['dimension_l_mm', 'dimension_w_mm', 'dimension_h_mm', 'sale_price', 'price']) {
  assert.ok(columns.includes(name), name);
}
for (const name of ['middle_price', 'size_l', 'size_w', 'size_h', 'factory', 'factories_display_name', 'images']) {
  assert.equal(columns.includes(name), false, name);
}

const product = {
  id: 'p1',
  title: '橡木會議桌',
  model: 'HZ-1',
  sku: null,
  sale_price: 12800,
  price: 9000,
  material: '橡木',
  color: '原色',
  dimension_l_mm: 1800,
  dimension_w_mm: 900,
  dimension_h_mm: 750,
  level1_category: '桌',
  level2_category: '會議桌',
  factories_display_name: '華座',
};

const built = g.buildGenerationRequest({
  title: '季度匯報',
  client: '甲公司',
  project: '總部',
  purpose: '選品',
  language: '繁體中文',
  style: '簡潔',
  pageCount: 8,
  content: '原文一段',
  outline: '1. 開場\n- 目標\n2. 方案',
}, [product]);
assert.ok(built.brief.includes('季度匯報'));
assert.ok(built.brief.includes('甲公司'));
assert.ok(built.brief.includes('HK$12,800'));
assert.ok(built.brief.includes('1800 × 900 × 750'));
assert.equal(built.brief.includes('華座'), false);
assert.equal(JSON.stringify(built.outline).includes('供應商'), false);
assert.ok(built.brief.length <= 5000);
assert.equal(built.design_type.type, 'preset');
assert.equal(built.design_type.name, 'presentation');
assert.equal(JSON.stringify(built.outline.sections.map((section) => section.title)), JSON.stringify(['開場', '方案', '橡木會議桌']));
assert.ok(built.outline.sections[0].points.includes('目標'));
assert.equal(built.report.products_included, 1);

const long = g.buildGenerationRequest({
  title: '長文',
  client: '乙公司',
  content: '內'.repeat(8000),
  outline: '大'.repeat(8000),
}, [product]);
assert.ok(long.brief.length <= 5000);
assert.ok(long.brief.includes('橡木會議桌'));
assert.ok(long.brief.includes('HK$12,800'));

const many = Array.from({ length: 100 }, (_, index) => ({ ...product, id: `p${index}`, title: `產品${index + 1}` }));
const capped = g.buildGenerationRequest({ title: '很多產品', outline: '' }, many);
assert.equal(capped.outline.sections.length, 100);
assert.equal(capped.outline.sections[0].title, '很多產品');
assert.equal(capped.report.products_included, 99);
assert.equal(capped.report.sections_truncated, true);
assert.equal(capped.outline.sections.at(-1).title, '產品99');

assert.ok(g.CREDIT_QUOTA_MESSAGE.includes('點數'));
assert.ok(g.DESIGN_GENERATION_MISSING_MESSAGE.includes('design_generation'));
assert.ok(g.RECONNECT_PROFILE_MESSAGE.includes('profile:read'));
console.log('canva generation tests ok');
