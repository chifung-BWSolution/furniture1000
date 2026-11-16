-- Existing supplier_logins rows were created before factory_code was stored.
-- Derive the code from the PMS display name ("1.向氏 QXS" → QXS) and also match
-- supplier_documents by the stored factory_name, so historical uploads appear.

create or replace function public.fds_supplier_factory_identifiers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    l.factory_id,
    nullif(upper(btrim(coalesce(l.factory_code, ''))), ''),
    nullif(btrim(coalesce(l.factory_name, '')), ''),
    nullif(btrim(regexp_replace(coalesce(l.factory_name, ''), '^\s*\d+\s*[.、]\s*', '')), ''),
    case
      when btrim(split_part(coalesce(l.factory_name, ''), ' ', -1)) ~ '^[A-Za-z0-9_-]{2,12}$'
        then upper(btrim(split_part(coalesce(l.factory_name, ''), ' ', -1)))
      else null
    end
  ], null)
  from public.supplier_logins l
  where l.active is true
    and lower(l.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;
revoke all on function public.fds_supplier_factory_identifiers() from public, anon;
grant execute on function public.fds_supplier_factory_identifiers() to authenticated;

create or replace function public.fds_supplier_review_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_factory_ids text[];
  v_supplier boolean := public.bwf_has_role(array['supplier']);
begin
  if public.bwf_has_role(array['admin', 'uploader']) then
    return coalesce((
      select jsonb_agg(row_to_json(d) order by d.created_at desc)
      from (
        select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
        from public.supplier_documents s
        order by s.created_at desc
        limit 80
      ) d
    ), '[]'::jsonb);
  end if;

  if not v_supplier then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_factory_ids := public.fds_supplier_factory_identifiers();
  if v_factory_ids is null or cardinality(v_factory_ids) = 0 then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(d) order by d.created_at desc)
    from (
      select s.id, s.title, s.status, s.factory_id, s.factory_name, s.doc_type, s.created_at, s.error_message
      from public.supplier_documents s
      where s.factory_id = any(v_factory_ids)
         or s.factory_name = any(v_factory_ids)
      order by s.created_at desc
      limit 80
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.fds_supplier_review_documents() from public, anon;
grant execute on function public.fds_supplier_review_documents() to authenticated;

notify pgrst, 'reload schema';
