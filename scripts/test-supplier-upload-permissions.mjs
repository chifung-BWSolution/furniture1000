#!/usr/bin/env node
/**
 * FDS Supplier RFQ §6.2 live test (branch only; everything rolls back).
 *
 * Proves, with a real Postgres session and JWT claims impersonation:
 *   - a supplier can create a document for its own factory only
 *   - a different factory_id is rejected with factory_mismatch
 *   - a storage path outside the factory folder is rejected
 *   - the same object is a duplicate, not a second document
 *   - a supplier cannot enqueue another factory's document
 *   - storage RLS hides other factories' objects
 *   - designer is rejected, admin keeps the old behaviour
 *
 *   node scripts/test-supplier-upload-permissions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BRANCH_REF = 'omxizeukbcqzsnjsuwod';
const ROOT = path.resolve(import.meta.dirname, '..');
const TAG = Date.now().toString(36);
const SUPPLIER_EMAIL = `fds-supplier-upload-${TAG}@example.invalid`;
const DESIGNER_EMAIL = `fds-designer-upload-${TAG}@example.invalid`;
const ADMIN_EMAIL = `fds-admin-upload-${TAG}@example.invalid`;
const FACTORY = `test-factory-${TAG}`;
const OTHER_FACTORY = `other-factory-${TAG}`;
const HASH = `hash${TAG}`;

function readToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const envPath = path.join(ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error('SUPABASE_ACCESS_TOKEN not found (env or .env.local)');
}

const token = readToken();

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${BRANCH_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL failed: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : [];
}

const ownStorage = `${FACTORY}/${HASH}.pdf`;
const otherStorage = `${OTHER_FACTORY}/${HASH}.pdf`;

const sqlText = `
begin;

insert into public.platform_user_profiles (auth_user_id, email, role, active, display_name)
values
  ('11111111-1111-4111-8111-111111111111', '${SUPPLIER_EMAIL}', 'supplier', true, 'FDS upload test supplier'),
  ('22222222-2222-4222-8222-222222222222', '${DESIGNER_EMAIL}', 'designer', true, 'FDS upload test designer'),
  ('33333333-3333-4333-8333-333333333333', '${ADMIN_EMAIL}', 'admin', true, 'FDS upload test admin');

insert into public.supplier_logins (email, factory_id, factory_name, active)
values ('${SUPPLIER_EMAIL}', '${FACTORY}', '測試廠家 ${TAG}', true);

insert into storage.objects (bucket_id, name, metadata)
values
  ('supplier-documents', '${ownStorage}', '{"size":1234}'::jsonb),
  ('supplier-documents', '${otherStorage}', '{"size":1234}'::jsonb),
  ('supplier-documents', '${OTHER_FACTORY}/other-${HASH}.pdf', '{"size":1234}'::jsonb),
  ('supplier-documents', '${OTHER_FACTORY}/admin-${HASH}.pdf', '{"size":1234}'::jsonb);

-- A document that belongs to another factory, for the enqueue test.
-- Seed it as a certificate so the insert trigger does not try to enqueue it
-- without a JWT; the update below only changes the type.
insert into public.supplier_documents (factory_id, factory_name, doc_type, title, storage_path, status)
values ('${OTHER_FACTORY}', 'Other factory', 'certificate', 'other', '${otherStorage}', 'uploaded');
update public.supplier_documents set doc_type = 'price_list' where storage_path = '${otherStorage}';
select set_config('fds.test_other_doc',
  (select id::text from public.supplier_documents where storage_path = '${otherStorage}' limit 1), true);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","email":"${SUPPLIER_EMAIL}","role":"authenticated"}';

do $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'auth.uid() is null'; end if;

  -- 1. Own factory upload succeeds.
  v := public.fds_supplier_document_create(
    '${ownStorage}', '${FACTORY}', 'ignored name', '我的報價單', 'price_list',
    'HKD', '${HASH}', 'upload', false, '{"document_year":2026}'::jsonb);
  if (v->>'documentId') is null or (v->>'duplicate')::boolean then
    raise exception 'own upload did not create a document: %', v;
  end if;
  perform set_config('fds.test_own_doc', v->>'documentId', true);

  -- 2. Same object again = duplicate, no second document.
  v := public.fds_supplier_document_create(
    '${ownStorage}', '${FACTORY}', 'ignored name', '我的報價單', 'price_list',
    'HKD', '${HASH}', 'upload', false, '{"document_year":2026}'::jsonb);
  if coalesce((v->>'duplicate')::boolean, false) is not true then
    raise exception 'repeat upload was not a duplicate: %', v;
  end if;

  -- 3. Another factory id is rejected.
  begin
    perform public.fds_supplier_document_create(
      '${ownStorage}', '${OTHER_FACTORY}', 'x', 'x', 'price_list',
      'HKD', '${HASH}b', 'upload', false, '{"document_year":2026}'::jsonb);
    raise exception 'factory mismatch was accepted';
  exception when others then
    if sqlerrm <> 'factory_mismatch' then raise; end if;
  end;

  -- 4. A path outside the factory folder is rejected even with the right factory id.
  begin
    perform public.fds_supplier_document_create(
      '${otherStorage}', '${FACTORY}', 'x', 'x', 'price_list',
      'HKD', '${HASH}c', 'upload', false, '{"document_year":2026}'::jsonb);
    raise exception 'foreign storage path was accepted';
  exception when others then
    if sqlerrm <> 'storage_path_invalid' then raise; end if;
  end;

  -- 5. Supplier cannot enqueue another factory's document.
  begin
    perform public.fds_supplier_document_enqueue_parse(
      current_setting('fds.test_other_doc')::uuid);
    raise exception 'foreign document enqueue was accepted';
  exception when others then
    if sqlerrm <> 'permission_denied' then raise; end if;
  end;

  -- 6. Storage RLS: own folder visible, other factory hidden.
  if not exists (select 1 from storage.objects where name = '${ownStorage}') then
    raise exception 'supplier cannot see its own storage object';
  end if;
  if exists (select 1 from storage.objects where name like '${OTHER_FACTORY}/%') then
    raise exception 'supplier can see another factory storage object';
  end if;

  -- 6b. Storage insert policy: own folder allowed, other factory denied.
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('supplier-documents', '${FACTORY}/rls-${HASH}.pdf', '{"size":1}'::jsonb);
  exception when others then
    raise exception 'supplier cannot insert into its own storage folder: %', sqlerrm;
  end;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('supplier-documents', '${OTHER_FACTORY}/rls-${HASH}.pdf', '{"size":1}'::jsonb);
    raise exception 'supplier inserted an object in another factory folder';
  exception when insufficient_privilege then null; -- expected RLS denial
  end;
end $$;

-- 7. Enqueue own document through the same RPC used by the create path.
do $$
declare
  v_doc uuid;
  v_job uuid;
begin
  v_doc := current_setting('fds.test_own_doc')::uuid;
  v_job := (public.fds_supplier_document_enqueue_parse(v_doc)->>'jobId')::uuid;
  if v_job is null then raise exception 'enqueue returned no job'; end if;
  perform set_config('fds.test_own_job', v_job::text, true);
end $$;

-- 8. Designer is rejected.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","email":"${DESIGNER_EMAIL}","role":"authenticated"}';
do $$
begin
  begin
    perform public.fds_supplier_document_create(
      '${ownStorage}', '${FACTORY}', 'x', 'x', 'certificate',
      null, '${HASH}d', 'upload', false, '{"document_year":2026}'::jsonb);
    raise exception 'designer upload was accepted';
  exception when others then
    if sqlerrm <> 'permission_denied' then raise; end if;
  end;
end $$;

-- 9. Admin keeps the previous behaviour: can target any factory and any folder.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","email":"${ADMIN_EMAIL}","role":"authenticated"}';
do $$
declare
  v jsonb;
begin
  v := public.fds_supplier_document_create(
    '${OTHER_FACTORY}/admin-${HASH}.pdf', '${OTHER_FACTORY}', 'Admin uploads', 'admin 憑證',
    'certificate', null, '${HASH}e', 'upload', false, '{"document_year":2026}'::jsonb);
  if (v->>'documentId') is null then raise exception 'admin upload failed: %', v; end if;
end $$;

-- 10. Back as the database owner: the queued parse job really exists.
reset role;
do $$
begin
  if not exists (
    select 1 from public.processing_jobs
    where id = current_setting('fds.test_own_job')::uuid
      and document_id = current_setting('fds.test_own_doc')::uuid
      and job_type = 'parse_pdf'
  ) then
    raise exception 'parse job was not created';
  end if;
end $$;

select 'PASS supplier upload permissions (branch, rolled back)';
rollback;
`;

try {
  const rows = await sql(sqlText);
  console.log(Object.values(rows[0] || {})[0] || rows);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
