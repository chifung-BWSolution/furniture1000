import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
const source=fs.readFileSync('src/lib/imageThumb.ts','utf8').replaceAll('import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS','undefined').replaceAll('import.meta.env.VITE_SUPABASE_URL', 'undefined');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {toThumbUrl,originalImageUrl}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const original='https://example.supabase.co/storage/v1/object/public/product-images/products/a%20b.jpg';
test('persisted thumbnail mapping is reversible and idempotent',()=>{
 const thumb=toThumbUrl(original); assert.ok(thumb.includes('/__thumbs/v1/products/a%20b.jpg.webp'));
 assert.equal(originalImageUrl(thumb),original);assert.equal(toThumbUrl(thumb),thumb);
});
test('large previews, external images and existing catalog thumbs stay direct',()=>{
 assert.equal(toThumbUrl(original,{width:1600}),original);
 assert.equal(toThumbUrl('https://cdn.shopify.com/a.jpg'),'https://cdn.shopify.com/a.jpg');
 const catalog=original.replace('products/a%20b.jpg','catalog-thumbs/doc/1.jpg');assert.equal(toThumbUrl(catalog),catalog);
});
test('legacy transform URLs no longer invoke transformations',()=>{
 const legacy=original.replace('/object/','/render/image/')+'?width=320&quality=65';
 assert.equal(originalImageUrl(legacy),original);assert.ok(!toThumbUrl(legacy).includes('/render/image/'));
});

test('own-project images use the materializing endpoint',async()=>{
 const ownSource=fs.readFileSync('src/lib/imageThumb.ts','utf8').replaceAll('import.meta.env.VITE_SUPABASE_IMAGE_TRANSFORMS','undefined').replaceAll('import.meta.env.VITE_SUPABASE_URL',JSON.stringify('https://example.supabase.co'));
 const compiled=ts.transpileModule(ownSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
 const own=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
 assert.equal(own.toThumbUrl(original),'/api/image-thumbnail?path=products%2Fa%20b.jpg');
 assert.equal(own.toThumbUrl(original,{width:1600}),original);
});
