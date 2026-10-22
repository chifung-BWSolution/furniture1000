-- Expose only numeric parsing progress through the existing role-checked catalog RPC.
create or replace function public.fds_designer_catalogs(
  p_query text default null,
  p_factory text default null,
  p_doc_type text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_open boolean;
  v_q text := lower(btrim(coalesce(p_query, '')));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_open := public.bwf_has_role(array['admin', 'uploader']);

  return jsonb_build_object(
    'can_open_source', v_open,
    'factories', coalesce((
      select jsonb_agg(name order by name)
      from (
        select distinct d.factory_name as name
        from public.supplier_documents d
        where btrim(d.factory_name) <> ''
      ) names
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(row_to_json(x) order by x.created_at desc)
      from (
        select
          d.id,
          nullif(d.title, '') as title,
          nullif(d.factory_name, '') as factory_name,
          d.doc_type,
          d.status,
          d.page_count,
          case when d.status = 'parsing' then (
            -- Reuse worker progress (0..1); split parents aggregate their children.
            select avg(case
              when part.status in ('review', 'ready') then 1::numeric
              else coalesce((
                select greatest(0, least(1, j.progress))
                from public.processing_jobs j
                where j.document_id = part.id and j.job_type = 'parse_pdf'
                order by j.created_at desc, j.id desc
                limit 1
              ), 0)
            end)
            from public.supplier_documents part
            where case when coalesce(d.part_count, 0) > 0
              then part.parent_document_id = d.id
              else part.id = d.id end
          ) else null end as parsing_progress,
          d.created_at,
          (
            select count(distinct r.product_id)::int
            from public.product_source_refs r
            where r.document_id = d.id
          ) as product_count,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'seq', s.seq,
              'start_page', s.start_page,
              'end_page', s.end_page,
              'kind', s.kind,
              'title', nullif(btrim(s.title), '')
            ) order by s.seq)
            from public.supplier_document_segments s
            where s.document_id = d.id
          ), '[]'::jsonb) as segments
        from public.supplier_documents d
        where (p_factory is null or btrim(p_factory) = '' or d.factory_name = p_factory)
          and (
            p_doc_type is null
            or p_doc_type not in ('quote', 'catalog')
            or d.doc_type = p_doc_type
          )
          and (
            v_q = ''
            or lower(coalesce(d.title, '')) like '%' || public.fds_like_escape(v_q) || '%'
            or lower(d.factory_name) like '%' || public.fds_like_escape(v_q) || '%'
            or exists (
              select 1 from public.supplier_document_segments s
              where s.document_id = d.id
                and lower(coalesce(s.title, '')) like '%' || public.fds_like_escape(v_q) || '%'
            )
          )
        order by d.created_at desc
        limit 200
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.fds_designer_catalogs(text, text, text) from public, anon;
grant execute on function public.fds_designer_catalogs(text, text, text) to authenticated;

