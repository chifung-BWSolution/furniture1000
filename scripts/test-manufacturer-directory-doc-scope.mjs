// Verifies manufacturer_directory_signals omits quote/price_list rows in catalog_only scope.
import fs from 'node:fs';

const ref = process.argv.find((a) => a.startsWith('--ref='))?.slice(6);
if (!ref) throw new Error('Pass --ref=<project-ref>');
let token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token && fs.existsSync('.env.local')) {
  token = fs.readFileSync('.env.local', 'utf8').match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
}
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN required');

const migration = fs.readFileSync(
  'supabase/migrations/20261026181500_manufacturer_directory_catalog_access.sql',
  'utf8',
);

const query = `begin;
${process.argv.includes('--installed') ? '' : migration}
do $$
declare
  v_all jsonb;
  v_catalog jsonb;
  v_has_quote boolean;
begin
  v_all := public.manufacturer_directory_signals(2026, 'all');
  v_catalog := public.manufacturer_directory_signals(2026, 'catalog_only');
  select exists (
    select 1
    from jsonb_array_elements(coalesce(v_all->'documents', '[]'::jsonb)) elem
    where elem->>'doc_type' in ('quote', 'price_list')
  ) into v_has_quote;
  if not v_has_quote then
    raise notice 'skip: no quote/price_list supplier_documents in DB';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_catalog->'documents', '[]'::jsonb)) elem
    where elem->>'doc_type' <> 'catalog'
  ) then
    raise exception 'catalog_only scope leaked non-catalog document types';
  end if;
end $$;
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
console.log('manufacturer-directory-doc-scope: ok');
