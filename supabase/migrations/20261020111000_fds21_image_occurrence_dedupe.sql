-- 圖片「出現頁數」改用 文件／圖片／頁碼 的唯一關聯計數，重試不再重複加總。
--
-- 問題：process-jobs 只在 supplier_document_images 記住「第一頁」與一個累加次數，
-- 同一個 unit 重跑（Gemini 失敗後重試）時，已經算過的頁又被加一次：
-- 同一張圖出現在第 1、2 頁 → 首次計數 2 → 重試後變 3 → 被當成 logo，
-- fds_extraction_items_finalize 就把真正的產品圖從待審項目移除。
--
-- 修正：seen_pages 存住這張圖出現過的頁碼（唯一集合），
-- page_occurrences = cardinality(seen_pages)。同一組頁碼再跑一次，結果一樣。

alter table public.supplier_document_images
  add column if not exists seen_pages int[] not null default '{}';

-- 舊資料只知道第一頁：先歸位（=1 頁），重新解析時會重建真實頁數。
update public.supplier_document_images
set seen_pages = array[page_no],
    page_occurrences = 1
where cardinality(seen_pages) = 0;

-- ── worker RPC：記錄一次圖片出現（冪等）──────────────────────────────

create or replace function public.fds_supplier_document_image_record(
  p_document_id uuid,
  p_content_hash text,
  p_pages int[],
  p_page_no int,
  p_storage_path text,
  p_public_url text,
  p_width int default null,
  p_height int default null,
  p_byte_size int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.supplier_document_images%rowtype;
  v_pages int[];
begin
  select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
    into v_pages
  from unnest(coalesce(p_pages, '{}'::int[])) as t(v)
  where t.v is not null;

  if cardinality(v_pages) = 0 then
    raise exception 'pages_required' using errcode = '22023';
  end if;

  insert into public.supplier_document_images as sdi (
    document_id, page_no, storage_path, public_url, width, height, byte_size,
    content_hash, page_occurrences, seen_pages, image_type
  )
  values (
    p_document_id, p_page_no, p_storage_path, p_public_url, p_width, p_height, p_byte_size,
    p_content_hash, cardinality(v_pages), v_pages,
    case when cardinality(v_pages) >= 3 then 'logo' else 'other' end
  )
  on conflict (document_id, content_hash) do update
    set seen_pages = (
          select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
          from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
        ),
        page_occurrences = cardinality((
          select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
          from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
        )),
        image_type = case
          when cardinality((
            select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
            from unnest(coalesce(sdi.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
          )) >= 3 then 'logo'
          else sdi.image_type
        end
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'content_hash', v_row.content_hash,
    'page_no', v_row.page_no,
    'page_occurrences', v_row.page_occurrences,
    'image_type', v_row.image_type
  );
end;
$$;

revoke all on function public.fds_supplier_document_image_record(uuid, text, int[], int, text, text, int, int, int) from public, anon, authenticated;
grant execute on function public.fds_supplier_document_image_record(uuid, text, int[], int, text, text, int, int, int) to service_role;

-- 重新解析前清空計數（seen_pages 只留第一頁，之後由各 unit 累加）。
create or replace function public.fds_supplier_document_images_reset(p_document_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.supplier_document_images
  set seen_pages = array[page_no],
      page_occurrences = 1,
      image_type = 'other'
  where document_id = p_document_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fds_supplier_document_images_reset(uuid) from public, anon, authenticated;
grant execute on function public.fds_supplier_document_images_reset(uuid) to service_role;

notify pgrst, 'reload schema';
