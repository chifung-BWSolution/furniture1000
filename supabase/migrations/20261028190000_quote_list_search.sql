-- Quote list search must run before pagination. The previous overload only
-- returned a page of latest chains, and the UI filtered that page in memory.
-- SECURITY INVOKER so bwf_quote RLS still applies to the caller.

drop function if exists public.latest_quote_version_ids();
drop function if exists public.latest_quote_version_ids(boolean);

create function public.latest_quote_version_ids(
  p_large_amount boolean default false,
  p_search text default null,
  p_pitching_ids uuid[] default null
)
returns table(id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select case
      when coalesce(btrim(p_search), '') = '' then null
      else '%' || replace(replace(replace(left(btrim(p_search), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pattern
  ),
  latest as (
    select distinct on (q.quote_id)
      q.id,
      q.created_at,
      q.total_amount,
      q.quote_id,
      q.version,
      q.status,
      q.submitter,
      q.bwf_pitching_id,
      q.project_data
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
  )
  select latest.id
  from latest
  cross join params
  where (not coalesce(p_large_amount, false) or latest.total_amount > 50000)
    and (
      params.pattern is null
      or latest.quote_id ilike params.pattern escape '\'
      or coalesce(latest.version, '') ilike params.pattern escape '\'
      or coalesce(latest.status, '') ilike params.pattern escape '\'
      or coalesce(latest.submitter, '') ilike params.pattern escape '\'
      or coalesce(latest.project_data #>> '{formData,clientName}', '') ilike params.pattern escape '\'
      or coalesce(latest.project_data #>> '{formData,clientContactName}', '') ilike params.pattern escape '\'
      or coalesce(latest.project_data #>> '{formData,projectManager}', '') ilike params.pattern escape '\'
      or coalesce(latest.project_data #>> '{clientInfo,name}', '') ilike params.pattern escape '\'
      or coalesce(latest.project_data #>> '{clientInfo,contactName}', '') ilike params.pattern escape '\'
      or (
        p_pitching_ids is not null
        and cardinality(p_pitching_ids) > 0
        and latest.bwf_pitching_id = any(p_pitching_ids)
      )
    )
  order by latest.created_at desc nulls last, latest.id desc
$$;

-- Preserve the original no-argument contract for report callers.
create function public.latest_quote_version_ids()
returns table(id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select id from public.latest_quote_version_ids(false, null, null)
$$;

revoke all on function public.latest_quote_version_ids(boolean, text, uuid[]) from public, anon;
grant execute on function public.latest_quote_version_ids(boolean, text, uuid[]) to authenticated, service_role;

revoke all on function public.latest_quote_version_ids() from public, anon;
grant execute on function public.latest_quote_version_ids() to authenticated, service_role;

notify pgrst, 'reload schema';
