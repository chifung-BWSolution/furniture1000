-- Server-side replacements for two full-table scans in the quote-usage report.
-- Apply in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

-- Latest bwf_quote.id per quote_id chain (one row per quote_id).
create or replace function public.latest_quote_version_ids()
returns table(id uuid)
language sql
stable
set search_path = public
as $$
  select distinct on (btrim(quote_id)) id
  from public.bwf_quote
  where quote_id is not null and btrim(quote_id) <> ''
  order by btrim(quote_id), created_at desc nulls last
$$;

-- NOTE: a catalog_product_index() RPC was considered but PostgREST caps RPC
-- responses at max-rows (1000), which would silently drop ~2k distinct titles.
-- The client keeps its paginated scan for the catalog index instead.
