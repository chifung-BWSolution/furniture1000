import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/presentationOutlineModel.ts', import.meta.url), 'utf8');
const context = { exports: {} };
vm.createContext(context);
vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { emptyProductDraft, presentationOutlineMarkdown, presentationGenerateBlock } = context.exports;
const product = { id: 'p', title: '桌', image_url: 'https://example.com/main.jpg', image_urls: ['https://example.com/other.jpg'] };
const draft = emptyProductDraft(product);
assert.equal(draft.imageUrl, product.image_url);
const input = { title: '項目', client: '客戶', includeFloor: false, zones: [{ id: 'z', name: '辦公室' }], products: [product], productZone: { p: 'z' }, drafts: { p: draft }, company: { background: '舊公司介紹' }, companyIntro: '', qualifications: '', services: '', cases: [] };
assert.equal(presentationGenerateBlock(input), null);
assert.ok(!presentationOutlineMarkdown(input).includes('舊公司介紹'));
assert.match(presentationOutlineMarkdown(input), /服務承諾\n內容待補充[\s\S]*資質\n內容待補充[\s\S]*公司介紹\n內容待補充$/);
assert.match(presentationOutlineMarkdown({ ...input, services: '服務內容', qualifications: '資質內容', companyIntro: '公司內容' }), /服務承諾\n服務內容[\s\S]*資質\n資質內容[\s\S]*公司介紹\n公司內容$/);
assert.match(presentationGenerateBlock({ ...input, client: '' }), /客戶/);
assert.match(presentationGenerateBlock({ ...input, zones: Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: '區' })) }), /100/);
assert.match(presentationGenerateBlock({ ...input, drafts: { p: { ...draft, noBackground: true } } }), /示例圖/);

// Zone cover comes first, then that zone's product page; no "all zones then all products".
const zoned = { ...input, includeFloor: true, floorImageUrl: 'https://example.com/plan.png', floorEffectImageUrl: 'https://example.com/plan-ai.png' };
const zonedOutline = presentationOutlineMarkdown(zoned);
assert.match(zonedOutline, /項目平面圖\n頁面主圖：AI 俯視效果圖/);
assert.match(zonedOutline, /分區封面｜辦公室\n分區：辦公室/);
assert.ok(zonedOutline.indexOf('分區封面｜辦公室') < zonedOutline.indexOf('產品頁｜辦公室｜桌'));
assert.match(zonedOutline, /產品圖：使用此產品的原圖/);
const withSample = presentationOutlineMarkdown({ ...zoned, drafts: { p: { ...draft, sampleImageUrl: 'https://example.com/sample.png' } }, zones: [{ id: 'z', name: '辦公室', imageUrl: 'https://example.com/zone.png' }] });
assert.match(withSample, /分區封面｜辦公室\n分區：辦公室\n頁面圖片：此分區的平面圖截圖/);
assert.match(withSample, /產品圖：使用此產品的 AI 生成示例圖/);

// Gamma image plan labels every slide image and marks the original plan as reference only.
const gammaSource = fs.readFileSync(new URL('../supabase/functions/generate-canva-presentation/gamma.ts', import.meta.url), 'utf8');
const gammaContext = { exports: {} };
vm.createContext(gammaContext);
vm.runInContext(ts.transpileModule(gammaSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, gammaContext);
const gammaPlan = gammaContext.exports.buildGammaImagePlan({
  floorImageUrl: 'https://example.com/plan.png',
  floorEffectImageUrl: 'https://example.com/plan-ai.png',
  presentationDraft: {
    zones: [{ id: 'z', name: '辦公室', imageUrl: 'https://example.com/zone.png' }],
    products: [{ id: 'p', title: '桌', image_url: 'https://example.com/main.jpg' }],
    productDrafts: { p: { displayName: '辦公桌', imageUrl: 'https://example.com/main.jpg', sampleImageUrl: 'https://example.com/sample.png' } },
  },
});
assert.match(gammaPlan, /「項目平面圖」頁主圖（AI 俯視效果圖，取代原本平面圖）：https:\/\/example\.com\/plan-ai\.png/);
assert.doesNotMatch(gammaPlan, /plan\.png/);
assert.match(gammaPlan, /「分區封面」頁：辦公室（該區平面圖截圖）：https:\/\/example\.com\/zone\.png/);
assert.match(gammaPlan, /產品頁「辦公桌」必須用此 AI 生成圖：https:\/\/example\.com\/sample\.png/);
assert.doesNotMatch(gammaPlan, /產品頁「辦公桌」用產品原圖/);
const fallbackPlan = gammaContext.exports.buildGammaImagePlan({ floorImageUrl: 'https://example.com/plan.png', presentationDraft: {} });
assert.match(fallbackPlan, /「項目平面圖」頁主圖（整體平面圖）：https:\/\/example\.com\/plan\.png/);
const gammaRequest = gammaContext.exports.buildGammaRequest({
  title: '項目',
  outline: '1. 封面',
  pageCount: 5,
  floorImageUrl: 'https://example.com/plan.png',
  floorEffectImageUrl: 'https://example.com/plan-ai.png',
  presentationDraft: {
    zones: [],
    products: [{ id: 'p', title: '桌', image_url: 'https://example.com/main.jpg' }],
    productDrafts: { p: { displayName: '辦公桌', imageUrl: 'https://example.com/main.jpg', sampleImageUrl: 'https://example.com/sample.png' } },
  },
});
assert.ok(gammaRequest.prompt.includes('plan-ai.png'));
assert.ok(!gammaRequest.prompt.includes('plan.png'));
assert.ok(gammaRequest.prompt.includes('sample.png'));
assert.ok(!gammaRequest.prompt.includes('main.jpg'));
const cardRequest = gammaContext.exports.buildGammaRequest({
  title: '項目', pageCount: 2, outline: '1. 封面\n\n2. 平面圖\n\n3. 分區封面｜A\n\n4. 產品頁｜A｜桌\n\n5. 服務承諾',
  presentationDraft: { zones: [], products: [], productDrafts: {} },
});
assert.equal(cardRequest.numCards, 5);
console.log('presentation outline tests ok');
