import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePdfUnitImages } from './pdfImageStore.mjs';

function harness() {
  const rows = new Map();
  const objects = new Map();
  const uploads = [];
  const images = [1, 2].map(n => ({ bytes: new Uint8Array([n]), width: 300, height: 300, area: 90_000 }));
  let decoded = 0;
  const bucket = {
    getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${path}` } }),
    upload: async (path, bytes) => { objects.set(path, bytes); uploads.push(path); return { error: null }; },
    download: async path => ({ data: new Blob([objects.get(path)]), error: null }),
  };
  const admin = {
    storage: { from: () => bucket },
    from: () => ({ select: () => ({ eq: () => ({ in: async (_, hashes) => ({
      data: [...rows.values()].filter(row => hashes.includes(row.content_hash)), error: null,
    }) }) }) }),
    rpc: async (_, p) => {
      const existing = rows.get(p.p_content_hash);
      const pages = [...new Set([...(existing?.seen_pages ?? []), ...p.p_pages])];
      const row = { ...existing, id: existing?.id ?? `id-${p.p_content_hash}`, content_hash: p.p_content_hash,
        storage_path: p.p_storage_path, public_url: p.p_public_url, byte_size: p.p_byte_size,
        seen_pages: pages, page_occurrences: pages.length };
      rows.set(p.p_content_hash, row);
      return { data: row, error: null };
    },
  };
  const options = { admin, documentId: 'doc', document: {}, pages: [1, 2],
    collectImages: () => images, hashBytes: async bytes => String(bytes[0]),
    normalizeImage: async (_, image) => { decoded++; return new Uint8Array([100 + image.bytes[0]]); } };
  return { rows, objects, uploads, options, decoded: () => decoded };
}

test('one image per checkpoint; cached RGB bytes are used on replay with stable IDs/page counts', async () => {
  const h = harness();
  const legacy = 'supplier-extracts/doc/1.jpg';
  h.rows.set('1', { id: 'reviewed-image', content_hash: '1', storage_path: legacy, byte_size: 1, seen_pages: [1] });
  h.objects.set(legacy, new Uint8Array([1]));
  assert.equal(await preparePdfUnitImages(h.options), null);
  assert.equal(h.decoded(), 1);
  assert.deepEqual(h.objects.get(legacy), new Uint8Array([101]), 'existing product links are repaired too');
  assert.equal(h.rows.get('1').id, 'reviewed-image');
  assert.equal(await preparePdfUnitImages(h.options), null);
  assert.equal(h.decoded(), 2);
  const result = await preparePdfUnitImages(h.options);
  assert.equal(h.decoded(), 2, 'cached images need no more decoding');
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'reviewed-image');
  assert.deepEqual(result.map(image => [...image.bytes]), [[101], [102]], 'model receives normalized pixels');
  assert.equal(h.rows.size, 2);
  for (const row of h.rows.values()) {
    assert.equal(row.page_occurrences, 2, 'retries never promote real pictures to logos');
    assert.match(row.storage_path, /-rgb-v1\.jpg$/);
  }
});

test('a decode error never uploads compressed PDF samples', async () => {
  const h = harness();
  h.options.normalizeImage = async () => { throw new Error('unsupported color'); };
  await assert.rejects(preparePdfUnitImages(h.options), /unsupported color/);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.rows.size, 0);
});

test('cached images obey the vision image and byte limits', async () => {
  const h = harness();
  await preparePdfUnitImages(h.options);
  await preparePdfUnitImages(h.options);
  assert.equal((await preparePdfUnitImages({ ...h.options, maxImages: 1 })).length, 1);
  assert.equal((await preparePdfUnitImages({ ...h.options, totalBytes: 0 })).length, 0);
});

test('private scan rejection checkpoints without publishing and is not retried', async () => {
 const h=harness(); const rejectedHashes=[]; let checks=0;
 const options={...h.options,rejectedHashes,validateImage:async()=>{checks++;return false;}};
 assert.equal(await preparePdfUnitImages(options),null);
 assert.equal(await preparePdfUnitImages(options),null);
 assert.deepEqual(await preparePdfUnitImages(options),[]);
 assert.equal(checks,2);assert.equal(h.uploads.length,0);assert.equal(h.rows.size,0);
});
test('small product pictures are retained after screening',async()=>{
 const h=harness();h.options.collectImages=()=>[{bytes:new Uint8Array([1]),width:248,height:156,area:38688}];
 const options={...h.options,validateImage:async()=>true};
 assert.equal(await preparePdfUnitImages(options),null);
 assert.equal((await preparePdfUnitImages(options)).length,1);
});
