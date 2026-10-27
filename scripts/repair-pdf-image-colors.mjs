#!/usr/bin/env node
/** Repair existing extracted pictures without rerunning OCR/AI or editing reviews.
 * Dry run by default. --ref, --document and --pdf are required; --apply writes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as pdfLib from 'pdf-lib';
import { getDocumentProxy, extractImages } from 'unpdf';
import jpeg from 'jpeg-js';
import { createClient } from '@supabase/supabase-js';
import { collectPdfPageImages, createPdfImageNormalizer } from '../supabase/functions/process-jobs/pdfImageColor.mjs';
import { PDF_IMAGE_COLOR_VERSION } from '../supabase/functions/process-jobs/pdfImageStore.mjs';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const ref = option('ref');
const documentId = option('document');
const sourcePath = option('pdf');
const apply = args.includes('--apply');
if (!/^[a-z]{20}$/.test(ref ?? '') || !/^[a-f0-9-]{36}$/.test(documentId ?? '') || !sourcePath) {
  throw new Error('Usage: node scripts/repair-pdf-image-colors.mjs --ref=<project-ref> --document=<uuid> --pdf=<original.pdf> [--apply]');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function concurrent(items, action, limit = 4) {
  let cursor = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && cursor < items.length) {
      const item = items[cursor++];
      try { await action(item); } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
}
const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(root, option('output') ?? `tmp/pdf-color/repair-${ref}-${documentId}`);
await fs.mkdir(output, { recursive: true });
const env = await fs.readFile(path.join(root, '.env.local'), 'utf8').catch(() => '');
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim()
  ?? env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN missing');
async function management(route, init = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/${route}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Management ${route} failed (${response.status})`);
  return response.json();
}
const query = sql => management('database/query', { method: 'POST', body: JSON.stringify({ query: sql }) });
const [document] = await query(`select id,content_hash from supplier_documents where id='${documentId}'`);
const input = new Uint8Array(await fs.readFile(sourcePath));
if (!document?.content_hash || hash(input) !== document.content_hash) {
  throw new Error('The supplied PDF does not match this document; refusing to repair');
}
const selection = `(select id from supplier_documents where id='${documentId}' or parent_document_id='${documentId}')`;
const reviewFingerprint = async () => (await query(`select count(*)::int as count,
  md5(coalesce(string_agg(row_to_json(e)::text, '' order by e.id), '')) as fingerprint
  from extraction_items e where document_id in ${selection}`))[0];
const beforeReview = await reviewFingerprint();
const rows = await query(`select id,document_id,content_hash,storage_path,public_url,width,height,
  byte_size,page_no,seen_pages,page_occurrences,image_type from supplier_document_images
  where document_id in ${selection} order by document_id,page_no,id`);
if (rows.length === 0) throw new Error('No extracted images found');
const backupPath = path.join(output, 'before.json');
// Keep the first pre-repair snapshot across retries.
await fs.writeFile(backupPath, JSON.stringify({ ref, documentId, sourceHash: hash(input), beforeReview, rows }, null, 2), { flag: 'wx' })
  .catch(error => { if (error.code !== 'EEXIST') throw error; });
const source = await pdfLib.PDFDocument.load(input);
const originals = new Map();
for (let page = 1; page <= source.getPageCount(); page++) for (const image of collectPdfPageImages(pdfLib, source, page)) {
  const key = hash(image.bytes);
  if (!originals.has(key)) originals.set(key, image);
}
const normalize = createPdfImageNormalizer({ pdfLib, getDocumentProxy, extractImages, encodeJpeg: jpeg.encode });
const normalizerHash = hash(await fs.readFile(path.join(root, 'supabase/functions/process-jobs/pdfImageColor.mjs')));
const previousPlan = await fs.readFile(path.join(output, 'plan.json'), 'utf8').then(JSON.parse).catch(() => null);
const prepared = new Map(previousPlan?.normalizerHash === normalizerHash && previousPlan?.sourceHash === hash(input)
  ? previousPlan.images.map(image => [image.id, image]) : []);
const plan = [];
const normalized = new Map();
// Validate and prepare every output before writing anything to the application.
for (const row of rows) {
  const storagePath = `supplier-extracts/${row.document_id}/${row.content_hash}-${PDF_IMAGE_COLOR_VERSION}.jpg`;
  if (row.storage_path === storagePath) continue;
  const image = originals.get(row.content_hash);
  if (!image || image.width !== row.width || image.height !== row.height) {
    throw new Error(`Source image does not match row ${row.id}`);
  }
  let bytes = normalized.get(row.content_hash);
  const cached = prepared.get(row.id);
  if (!bytes && cached) {
    const candidate = await fs.readFile(path.join(output, cached.output_file)).catch(() => null);
    if (candidate && hash(candidate) === cached.output_hash) bytes = new Uint8Array(candidate);
  }
  if (!bytes) {
    bytes = await normalize(source, image);
    normalized.set(row.content_hash, bytes);
  }
  const filename = `${row.id}.jpg`;
  await fs.writeFile(path.join(output, filename), bytes);
  plan.push({ ...row, next_path: storagePath, output_file: filename, output_hash: hash(bytes), output_bytes: bytes.length });
  if (plan.length % 20 === 0) console.log(`Prepared ${plan.length} images`);
}
await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify({ ref, documentId, sourceHash: hash(input), normalizerHash, version: PDF_IMAGE_COLOR_VERSION, images: plan }, null, 2));
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ref, images: rows.length, repair: plan.length, output }));
if (!apply) process.exit(0);

const keys = await management('api-keys');
const serviceKey = keys.find(key => key.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('Service role key unavailable');
const admin = createClient(`https://${ref}.supabase.co`, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const bucket = admin.storage.from('product-images');
const receiptPath = path.join(output, 'receipt.jsonl');
const backups = new Map(plan.map(row => [row.storage_path, path.join(output, `${row.id}-before.jpg`)]));
// Back up every unique original object before any uploads (parts can share URLs).
await concurrent([...backups], async ([storagePath, backup]) => {
  if (await fs.stat(backup).catch(() => null)) return;
  const { data, error } = await bucket.download(storagePath);
  if (error || !data) throw new Error(`Cannot back up existing image ${storagePath}`);
  await fs.writeFile(backup, new Uint8Array(await data.arrayBuffer()));
});
await fs.writeFile(path.join(output, 'backups.json'), JSON.stringify(Object.fromEntries(backups), null, 2));
const uploads = new Map();
let completed = 0;
await concurrent(plan, async row => {
  const bytes = new Uint8Array(await fs.readFile(path.join(output, row.output_file)));
  if (hash(bytes) !== row.output_hash) throw new Error(`Prepared image changed: ${row.id}`);
  for (const destination of new Set([row.storage_path, row.next_path])) {
    if (!uploads.has(destination)) uploads.set(destination, (async () => {
      const { error } = await bucket.upload(destination, bytes, { contentType: 'image/jpeg', cacheControl: '60', upsert: true });
      if (error) throw new Error(`Image upload failed: ${row.id}: ${error.message}`);
    })());
    await uploads.get(destination);
  }
  const publicUrl = bucket.getPublicUrl(row.next_path).data.publicUrl;
  const { data: recorded, error } = await admin.rpc('fds_supplier_document_image_record', {
    p_document_id: row.document_id, p_content_hash: row.content_hash,
    p_pages: row.seen_pages.length ? row.seen_pages : [row.page_no], p_page_no: row.page_no,
    p_storage_path: row.next_path, p_public_url: publicUrl, p_width: row.width,
    p_height: row.height, p_byte_size: bytes.length,
  });
  if (error || recorded?.id !== row.id || recorded.page_occurrences !== row.page_occurrences) {
    throw new Error(`Image identity/count verification failed: ${row.id}: ${error?.message ?? ''}`);
  }
  // Keep any image classification applied by review/the existing model flow.
  if (recorded.image_type !== row.image_type) {
    const { error } = await admin.from('supplier_document_images').update({ image_type: row.image_type }).eq('id', row.id);
    if (error) throw new Error(`Image type restore failed: ${row.id}`);
  }
  const fetched = await fetch(`${publicUrl}?color-check=${row.output_hash}`);
  if (!fetched.ok || hash(new Uint8Array(await fetched.arrayBuffer())) !== row.output_hash) {
    throw new Error(`Stored image read-back failed: ${row.id}`);
  }
  await fs.appendFile(receiptPath, JSON.stringify({ id: row.id, path: row.next_path, sha256: row.output_hash, verified: true }) + '\n');
  completed++;
  if (completed % 20 === 0) console.log(`Repaired and verified ${completed}/${plan.length}`);
});
const afterReview = await reviewFingerprint();
if (JSON.stringify(beforeReview) !== JSON.stringify(afterReview)) throw new Error('Review records changed during repair; inspect backup');
const remaining = await query(`select count(*)::int as count from supplier_document_images
  where document_id in ${selection} and storage_path not like '%-${PDF_IMAGE_COLOR_VERSION}.jpg'`);
if (remaining[0].count !== 0) throw new Error('Some image metadata was not updated; check the image record RPC migration');
const summary = { ref, documentId, repaired: completed, remaining: remaining[0].count, reviewsUnchanged: true };
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
