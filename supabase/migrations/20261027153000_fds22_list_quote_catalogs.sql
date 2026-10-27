-- FDS 2.2：報價附件可挑選圖冊。只回傳目錄資料，不回傳檔案路徑。
-- 報價單 PDF 仍不能經這支函式拿到。

create or replace function public.fds_list_quote_catalogs(
  p_query text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(
      (row_to_json(x)::jsonb - 'created_at')
      order by x.factory_name, x.document_year desc nulls last, x.created_at desc
    )
    from (
      select d.id,
             d.factory_name,
             d.title,
             d.document_year,
             d.series,
             d.product_categories,
             d.version_label,
             d.page_count,
             d.created_at
      from public.supplier_documents d
      where d.doc_type = 'catalog'
        and d.parent_document_id is null
        and d.status <> 'failed'
        and (
          v_q = ''
          or lower(d.factory_name) like '%' || public.fds_like_escape(lower(v_q)) || '%'
          or lower(coalesce(d.title, '')) like '%' || public.fds_like_escape(lower(v_q)) || '%'
          or lower(coalesce(d.series, '')) like '%' || public.fds_like_escape(lower(v_q)) || '%'
        )
      order by d.factory_name, d.document_year desc nulls last, d.created_at desc
      limit 80
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_list_quote_catalogs(text) from public, anon;
grant execute on function public.fds_list_quote_catalogs(text) to authenticated;

notify pgrst, 'reload schema';
