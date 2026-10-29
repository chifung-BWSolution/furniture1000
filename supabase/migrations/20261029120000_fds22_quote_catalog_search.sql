-- FDS 2.2：報價「圖冊附件」搜尋器改良。
-- 1. 多個關鍵字以空格分隔，全部命中才算（AND），不再要求整個字串連續出現。
-- 2. 一併搜年份與版本標籤（原本只搜廠家／標題／系列）。
-- 3. 只回傳目錄資料，不回傳檔案路徑；報價單 PDF 仍不能經這支函式拿到。

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
  v_tokens text[];
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_tokens := case
    when v_q = '' then '{}'::text[]
    else regexp_split_to_array(lower(v_q), '\s+')
  end;

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
        and not exists (
          select 1
          from unnest(v_tokens) as t(token)
          where t.token <> ''
            and position(
              t.token in lower(concat_ws(' ',
                d.factory_name,
                coalesce(d.title, ''),
                coalesce(d.series, ''),
                coalesce(d.version_label, ''),
                coalesce(d.document_year::text, '')
              ))
            ) = 0
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
