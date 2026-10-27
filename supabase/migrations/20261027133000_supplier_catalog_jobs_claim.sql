-- Night catalog worker claims supplier_document_jobs and hands each document
-- to the existing parse_pdf queue. The edge function is the only caller.

create or replace function public.fds_supplier_catalog_jobs_claim(
  p_limit integer default 20
) returns table (
  id uuid,
  document_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 0), 50);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  if not public.fds_document_parse_window_open() then
    return;
  end if;

  return query
  with claimed as (
    update public.supplier_document_jobs j
    set status = 'processing',
        started_at = coalesce(j.started_at, now()),
        attempt_count = j.attempt_count + 1,
        error_message = null
    where j.id in (
      select c.id
      from public.supplier_document_jobs c
      where c.status = 'pending'
         or (
           c.status = 'processing'
           and coalesce(c.started_at, c.created_at) < now() - interval '30 minutes'
         )
      order by c.created_at
      limit v_limit
      for update skip locked
    )
    returning j.id, j.document_id, j.attempt_count
  )
  select claimed.id, claimed.document_id, claimed.attempt_count
  from claimed;
end;
$$;

revoke all on function public.fds_supplier_catalog_jobs_claim(integer) from public, anon, authenticated;
grant execute on function public.fds_supplier_catalog_jobs_claim(integer) to service_role;

notify pgrst, 'reload schema';
