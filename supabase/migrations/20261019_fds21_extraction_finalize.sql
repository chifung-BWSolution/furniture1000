-- FDS 2.1 T-302：結構化完成後，跨整份文件標記重複型號並重算 needs_attention。
-- 單項規則（缺價、價錢不在原文、尺寸可疑…）由 worker 寫入 flags；這裡只補需要看全文件的規則。
-- 同一張圖出現在 3 頁以上＝logo／裝飾：worker 逐段處理時未必已數夠頁數，這裡統一從待審項目移除。

create or replace function public.fds_extraction_items_finalize(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total int;
  v_attention int;
begin
  update public.supplier_document_images
  set image_type = 'logo'
  where document_id = p_document_id and page_occurrences >= 3 and image_type <> 'logo';

  with logos as (
    select array_agg(i.id) as ids
    from public.supplier_document_images i
    where i.document_id = p_document_id and i.image_type = 'logo'
  ),
  cleaned as (
    select e.id,
           array(select x from unnest(e.image_ids) with ordinality as t(x, n)
                 where not (x = any (l.ids)) order by n) as image_ids,
           case when e.main_image_id = any (l.ids) then null else e.main_image_id end as main_image_id
    from public.extraction_items e, logos l
    where e.document_id = p_document_id
      and e.status = 'pending'
      and l.ids is not null
      and e.image_ids && l.ids
  )
  update public.extraction_items e
  set image_ids = c.image_ids,
      main_image_id = coalesce(c.main_image_id, c.image_ids[1])
  from cleaned c
  where e.id = c.id;

  update public.extraction_items e
  set flags = array_remove(e.flags, 'duplicate_model')
  where e.document_id = p_document_id and e.status = 'pending';

  with dup as (
    select lower(regexp_replace(e.raw_json ->> 'model', '\s+', '', 'g')) as model_key
    from public.extraction_items e
    where e.document_id = p_document_id
      and coalesce(e.raw_json ->> 'model', '') <> ''
    group by 1
    having count(*) > 1
  )
  update public.extraction_items e
  set flags = array_append(e.flags, 'duplicate_model')
  from dup
  where e.document_id = p_document_id
    and e.status = 'pending'
    and lower(regexp_replace(e.raw_json ->> 'model', '\s+', '', 'g')) = dup.model_key;

  update public.extraction_items e
  set needs_attention = coalesce(e.confidence, 0) < 0.7
        or e.flags && array['missing_price', 'price_not_in_source', 'missing_model',
                            'currency_missing', 'dimension_suspicious', 'duplicate_model'],
      updated_at = now()
  where e.document_id = p_document_id and e.status = 'pending';

  select count(*), count(*) filter (where needs_attention)
    into v_total, v_attention
  from public.extraction_items
  where document_id = p_document_id;

  return jsonb_build_object('items', v_total, 'needsAttention', v_attention);
end;
$$;

revoke all on function public.fds_extraction_items_finalize(uuid) from public, anon, authenticated;
grant execute on function public.fds_extraction_items_finalize(uuid) to service_role;

notify pgrst, 'reload schema';
