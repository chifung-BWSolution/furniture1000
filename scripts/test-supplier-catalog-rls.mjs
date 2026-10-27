// Transactional RLS regression for supplier catalog designer/PM scoping.
// Requires --ref=<project-ref> and SUPABASE_ACCESS_TOKEN (or .env.local).
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const ref = process.argv.find((a) => a.startsWith('--ref='))?.slice(6);
if (!ref) throw new Error('Pass --ref=<project-ref>');
let token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token && fs.existsSync('.env.local')) {
  token = fs.readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
}
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN required');

const migration = [
  'supabase/migrations/20261026173000_supplier_catalog_rls_scoping.sql',
  'supabase/migrations/20261026181500_manufacturer_directory_catalog_access.sql',
]
  .map((path) => fs.readFileSync(path, 'utf8'))
  .join('\n');
const actor = randomUUID();
const email = `supplier-rls-${actor}@example.invalid`;
const catalogPath = `catalogs/${actor}/2024/${randomUUID()}.pdf`;
const quotePath = `quotes/${actor}/${randomUUID()}.pdf`;
const catalogId = randomUUID();
const quoteId = randomUUID();
const jobId = randomUUID();

const claims = (role) =>
  `select set_config('request.jwt.claims', '${JSON.stringify({ sub: actor, role, email })}', true);`;
const assert = (condition, message) =>
  `do $$ begin if (${condition}) is not true then raise exception '${message}'; end if; end $$;`;

const query = `begin;
${process.argv.includes('--installed') ? '' : migration}
insert into public.platform_user_profiles(email, role, active) values ('${email}', 'designer', true);
insert into public.supplier_documents (
  id, factory_name, doc_type, title, storage_path, source, status, processing_status,
  document_year, series, product_categories
) values
(
  '${catalogId}', 'QA Factory', 'catalog', 'Catalog QA', '${catalogPath}', 'upload', 'uploaded', 'pending',
  2024, 'QA Series', array['chair']::text[]
),
(
  '${quoteId}', 'QA Factory', 'quote', 'Quote QA', '${quotePath}', 'upload', 'uploaded', 'not_applicable',
  null, null, '{}'::text[]
);
insert into public.supplier_document_jobs (id, document_id, status) values ('${jobId}', '${catalogId}', 'pending');
${claims('authenticated')}
set local role authenticated;
${assert(`public.bwf_has_role(array['designer'])`, 'Designer role missing')}
${assert(`(select count(*) = 1 from public.supplier_documents where id = '${catalogId}')`, 'Designer cannot read catalog row')}
${assert(`(select count(*) = 0 from public.supplier_documents where id = '${quoteId}')`, 'Designer can read quote row')}
${assert(`(select count(*) = 1 from public.supplier_document_jobs where document_id = '${catalogId}')`, 'Designer cannot read catalog job')}
reset role;
update public.platform_user_profiles set role = 'admin' where email = '${email}';
${claims('authenticated')}
set local role authenticated;
${assert(`(select count(*) = 2 from public.supplier_documents where id in ('${catalogId}', '${quoteId}'))`, 'Admin catalog/quote regression')}
rollback;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
const body = await res.text();
if (!res.ok) {
  console.error(body);
  process.exit(1);
}
console.log('supplier-catalog-rls: ok');
