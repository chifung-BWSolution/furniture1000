import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Run with @electric-sql/pglite installed, or set FDS_PGLITE_MODULE to its entry file.
const { PGlite } = await import(process.env.FDS_PGLITE_MODULE
  ? pathToFileURL(process.env.FDS_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const read = name => fs.readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const original = await read('20261019040749_fds21_supplier_documents_jobs.sql');
function table(name) {
  const start = original.indexOf(`create table if not exists public.${name} (`);
  return original.slice(start, original.indexOf('\n);', start) + 3);
}
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage; create schema cron;
  create function auth.role() returns text language sql as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role'); $$;
  create function public.bwf_has_role(text[]) returns boolean language sql as $$ select auth.role() <> 'anon'; $$;
  create function public.bwf_assert_role(text[]) returns void language plpgsql as $$ begin
    if auth.role() = 'anon' then raise exception 'permission_denied'; end if; end; $$;
  create function public.bwf_current_staff_id() returns uuid language sql as $$ select null::uuid; $$;
  create function cron.unschedule(text) returns boolean language sql as $$ select true; $$;
  create table storage.objects(bucket_id text, name text, metadata jsonb);
  ${table('supplier_documents')}
  ${table('processing_jobs')}
  alter table public.supplier_documents drop constraint supplier_documents_doc_type_check;
  alter table public.supplier_documents add check(doc_type in ('quote','catalog','price_list','certificate'));
  alter table public.supplier_documents
    add column parent_document_id uuid references public.supplier_documents(id),
    add column part_index int, add column page_offset int default 0,
    add column part_count int, add column parts_done int,
    add column document_year int, add column series text,
    add column product_categories text[] default '{}', add column version_label text,
    add column description text, add column processing_status text default 'pending';
  create table public.supplier_document_jobs(id uuid default gen_random_uuid(), document_id uuid, status text);
  insert into public.supplier_documents(factory_id, factory_name, doc_type, storage_path, document_year)
    values ('old', 'Legacy', 'price_list', 'old.pdf', 2025);
`);
const legacyStart = original.indexOf('create or replace function public.fds_supplier_document_create(');
const legacyCreate = original.slice(legacyStart, original.indexOf('\n$$;', legacyStart) + 4);
await db.exec(legacyCreate);
const migration = await read('20261026070000_fds22_unified_document_upload.sql');
await db.exec(migration);
// Replay the later reconciliation's overlapping definitions, in deployment order.
// It must not leave unified uploads using the pre-V2.2 constraint or queue.
const reconciliation = (await read('20261026103000_reconcile_supplier_catalog_schema.sql')).replaceAll('\r\n', '\n');
const constraintStart = reconciliation.lastIndexOf('alter table public.supplier_documents\n  drop constraint if exists supplier_documents_catalog_meta_chk;');
assert.ok(constraintStart >= 0, 'replays the actual reconciliation constraint');
await db.exec(reconciliation.slice(constraintStart, reconciliation.indexOf('drop index if exists supplier_documents_catalog_hash_uidx;', constraintStart)));
for (const name of ['force_supplier_catalog_pending', 'enqueue_supplier_catalog_job']) {
  const start = reconciliation.indexOf(`create or replace function public.${name}()`);
  await db.exec(reconciliation.slice(start, reconciliation.indexOf('$$;', start) + 3));
}
if (!process.env.FDS_REPRO_OLD_DOCUMENT_SCHEMA) {
  await db.exec(await read('20261027090000_restore_unified_document_contract.sql'));
}
await db.exec(`
  create trigger trg_supplier_catalog_pending before insert on public.supplier_documents
    for each row execute function public.force_supplier_catalog_pending();
  create trigger trg_supplier_catalog_enqueue after insert on public.supplier_documents
    for each row execute function public.enqueue_supplier_catalog_job();
`);
const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
// Legacy AI/archive callers use the retained nine-argument RPC without metadata.
await db.exec(`insert into supplier_documents(factory_id, factory_name, doc_type, storage_path, source)
  values ('legacy', 'Legacy catalog', 'catalog', 'legacy-catalog.pdf', 'ai_processor');`);
assert.equal(await scalar('select count(*)::int from public.processing_jobs'), 1, 'backfills old uploads');
assert.equal(await scalar("select count(*)::int from pg_proc where proname = 'fds_supplier_document_create'"), 2, 'keeps legacy RPC signature');

async function upload(type, name, meta, size = 1000) {
  await db.query(`insert into storage.objects values ('supplier-documents', $1, $2)`, [name, { size }]);
  return (await db.query(`select public.fds_supplier_document_create(
    $1, 'factory-a', 'Factory A', $1, $2, null, $1, 'upload', true, $3) as result`,
  [name, type, meta])).rows[0].result;
}
const meta = { document_year: 2024, series: 'Office', product_categories: ['Chairs'], version_label: 'A' };
const catalog = await upload('catalog', 'catalog.pdf', meta);
assert.ok(catalog.documentId);
assert.equal(await scalar(`select count(*)::int from processing_jobs where document_id = '${catalog.documentId}'`), 1,
  'trigger and RPC enqueue exactly one real job');
assert.equal(await scalar(`select processing_status from supplier_documents where id = '${catalog.documentId}'`), 'pending');
const duplicate = (await db.query(`select fds_supplier_document_create(
  'catalog.pdf','factory-a','Factory A','changed','catalog',null,'catalog.pdf','upload',true,$1) result`, [meta])).rows[0].result;
assert.equal(duplicate.duplicate, true);
assert.equal(await scalar(`select title from supplier_documents where id = '${catalog.documentId}'`), 'catalog.pdf');
assert.equal(await scalar(`select count(*)::int from processing_jobs where document_id = '${catalog.documentId}'`), 1);

const certificate = await upload('certificate', 'certificate.pdf', { document_year: 2026 });
assert.equal(await scalar(`select count(*)::int from processing_jobs where document_id = '${certificate.documentId}'`), 0);
assert.equal(await scalar(`select processing_status from supplier_documents where id = '${certificate.documentId}'`), 'not_applicable');
await assert.rejects(db.query(`select fds_supplier_document_enqueue_parse('${certificate.documentId}')`), /certificate_not_parseable/);
await assert.rejects(upload('catalog', 'invalid.pdf', { document_year: 2026 }), /catalog_metadata_required/);
await assert.rejects(upload('price_list', 'no-year.pdf', {}), /document_year_required/);
const large = await upload('price_list', 'large.pdf', { document_year: 2026 }, 80 * 1024 * 1024);
assert.equal(await scalar(`select job_type from processing_jobs where document_id = '${large.documentId}'`), 'needs_split');

await db.exec(`update processing_jobs set status = 'running' where document_id = '${catalog.documentId}';`);
assert.equal(await scalar(`select processing_status from supplier_documents where id = '${catalog.documentId}'`), 'processing');
await db.exec(`update processing_jobs set status = 'succeeded' where document_id = '${catalog.documentId}';
  update supplier_documents set status = 'review' where id = '${catalog.documentId}';`);
assert.equal(await scalar(`select processing_status from supplier_documents where id = '${catalog.documentId}'`), 'review_required');
await db.exec(`insert into supplier_documents(factory_id, factory_name, doc_type, storage_path, parent_document_id)
  values ('factory-a','Factory A','catalog','child.pdf','${catalog.documentId}');`);
assert.equal(await scalar("select document_year from supplier_documents where storage_path = 'child.pdf'"), 2024);
assert.deepEqual(await scalar("select product_categories from supplier_documents where storage_path = 'child.pdf'"), ['Chairs']);
assert.equal(await scalar('select count(*)::int from supplier_document_jobs'), 0, 'no parallel queue created');
await db.exec(await read('20261027100000_ai_document_upload_year.sql'));
await db.exec(`insert into storage.objects values ('supplier-documents', 'ai-year.pdf', '{"size":1000}');`);
const aiUpload = (await db.query(`select public.fds_supplier_document_create(
  'ai-year.pdf', 'factory-a', 'Factory A', 'Year catalog', 'catalog', 'RMB',
  'ai-year-hash', 'ai_processor', true, '{"document_year":2026}'::jsonb) as result`)).rows[0].result;
assert.equal(await scalar(`select document_year from supplier_documents where id = '${aiUpload.documentId}'`), 2026);
assert.equal(await scalar(`select currency from supplier_documents where id = '${aiUpload.documentId}'`), 'RMB');
assert.equal(await scalar(`select count(*)::int from processing_jobs where document_id = '${aiUpload.documentId}'`), 1);
await assert.rejects(upload('catalog', 'still-invalid.pdf', { document_year: 2026 }), /catalog_metadata_required/);
await assert.rejects(db.query(`select public.fds_supplier_document_create(
  'bad-year.pdf', 'factory-a', 'Factory A', 'Bad year', 'catalog', 'RMB',
  'bad-year', 'ai_processor', true, '{"document_year":2101}'::jsonb)`), /document_year_required/);
await db.exec("set request.jwt.claim.role = 'anon';");
await assert.rejects(upload('certificate', 'denied.pdf', { document_year: 2026 }), /permission_denied/);
await db.close();
console.log('Unified documents: migration, metadata, legacy backfill, deduplication, queue, certificates, large files and authorization passed');
