-- Reuse the existing report RPC for quote-list pagination. Both overloads are
-- SECURITY INVOKER so bwf_quote RLS continues to restrict the current caller.
create or replace function public.latest_quote_version_ids(p_large_amount boolean)
returns table(id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select latest.id
  from (
    select distinct on (q.quote_id)
      q.id, q.created_at, q.total_amount
    from public.bwf_quote q
    where q.quote_id is not null and btrim(q.quote_id) <> ''
      and q.status <> '回收桶'
    order by q.quote_id,
      case
        when btrim(q.version) ~* '^v[0-9]+\.[0-9]+$'
          then split_part(substr(btrim(q.version), 2), '.', 2)::numeric
        when btrim(q.version) ~* '^v[0-9]+$'
          then substr(btrim(q.version), 2)::numeric
        else 0
      end desc,
      q.created_at desc nulls last, q.id desc
  ) latest
  where not coalesce(p_large_amount, false) or latest.total_amount > 50000
  order by latest.created_at desc nulls last, latest.id desc
$$;

-- Preserve the original no-argument contract for report callers.
create or replace function public.latest_quote_version_ids()
returns table(id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select id from public.latest_quote_version_ids(false)
$$;

revoke all on function public.latest_quote_version_ids(boolean) from public, anon;
grant execute on function public.latest_quote_version_ids(boolean) to authenticated, service_role;
notify pgrst, 'reload schema';
