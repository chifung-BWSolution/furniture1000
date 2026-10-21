-- 超過 60MB 的供應商 PDF 不在 Edge 裡拆（記憶體裝不下）。
-- 瀏覽器或 Windows pdf-split worker 先把原檔切成約 40MB 的子文件，
-- 每段各跑既有 parse_pdf，再合併回父文件（頁碼加 page_offset，跨段去重）。
-- 父文件保留原始 PDF。part_count / parts_done 給列表顯示「X/N 段」。

alter table public.supplier_documents
  add column if not exists parent_document_id uuid references public.supplier_documents(id) on delete cascade,
  add column if not exists part_index int,
  add column if not exists page_offset int not null default 0,
  add column if not exists part_count int,
  add column if not exists parts_done int;

alter table public.supplier_documents
  drop constraint if exists supplier_documents_part_shape_check;
alter table public.supplier_documents
  add constraint supplier_documents_part_shape_check check (
    page_offset >= 0
    and (part_count is null or part_count >= 0)
    and (parts_done is null or parts_done >= 0)
    and (
      (parent_document_id is null and part_index is null)
      or (parent_document_id is not null and parent_document_id <> id and part_index >= 1)
    )
  );

create unique index if not exists supplier_documents_part_uidx
  on public.supplier_documents (parent_document_id, part_index)
  where parent_document_id is not null;

alter table public.supplier_document_pages
  add column if not exists source_part_id uuid references public.supplier_documents(id) on delete cascade;
alter table public.supplier_document_segments
  add column if not exists source_part_id uuid references public.supplier_documents(id) on delete cascade;
alter table public.supplier_document_images
  add column if not exists source_part_id uuid references public.supplier_documents(id) on delete cascade;
alter table public.extraction_items
  add column if not exists source_part_id uuid references public.supplier_documents(id) on delete cascade;

create index if not exists supplier_document_pages_source_part_idx
  on public.supplier_document_pages (source_part_id) where source_part_id is not null;
create index if not exists supplier_document_segments_source_part_idx
  on public.supplier_document_segments (source_part_id) where source_part_id is not null;
create index if not exists supplier_document_images_source_part_idx
  on public.supplier_document_images (source_part_id) where source_part_id is not null;
create index if not exists extraction_items_source_part_idx
  on public.extraction_items (source_part_id) where source_part_id is not null;

-- 子文件狀態一變，父文件顯示整體進度。已完成的段留在審核目錄，失敗段寫在 error_message。
create or replace function public.fds_supplier_document_refresh_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_total int;
  v_done int;
  v_failed int;
  v_parsing int;
  v_status text;
  v_error text;
begin
  v_parent := new.parent_document_id;
  if v_parent is null then
    return new;
  end if;

  select
    count(*)::int,
    count(*) filter (where status in ('review', 'ready'))::int,
    count(*) filter (where status = 'failed')::int,
    count(*) filter (where status = 'parsing')::int
  into v_total, v_done, v_failed, v_parsing
  from public.supplier_documents
  where parent_document_id = v_parent;

  if v_parsing > 0 then
    v_status := 'parsing';
    v_error := null;
  elsif v_total > 0 and v_done = v_total then
    v_status := 'review';
    v_error := null;
  elsif v_done > 0 then
    v_status := 'review';
    v_error := format(
      '已完成 %s/%s 段%s',
      v_done,
      v_total,
      case when v_failed > 0 then format('，%s 段失敗', v_failed) else '' end
    );
  elsif v_failed > 0 then
    v_status := 'failed';
    v_error := format('全部分段解析失敗（0/%s）', v_total);
  else
    v_status := 'uploaded';
    v_error := null;
  end if;

  update public.supplier_documents
  set status = v_status,
      error_message = v_error,
      part_count = v_total,
      parts_done = v_done,
      modified_date = now()
  where id = v_parent
    and parent_document_id is null;

  return new;
end;
$$;

drop trigger if exists trg_supplier_document_part_status on public.supplier_documents;
create trigger trg_supplier_document_part_status
  after insert or update of status on public.supplier_documents
  for each row
  when (new.parent_document_id is not null)
  execute function public.fds_supplier_document_refresh_parent();

revoke all on function public.fds_supplier_document_refresh_parent() from public, anon, authenticated;
grant execute on function public.fds_supplier_document_refresh_parent() to service_role;

-- 大檔改排 needs_split；已有子文件則重排每一段的 parse_pdf。service_role（worker）與職員都可呼叫。
create or replace function public.fds_supplier_document_enqueue_parse(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc public.supplier_documents%rowtype;
  v_job_id uuid;
  v_staff uuid := public.bwf_current_staff_id();
  v_child uuid;
  v_edge_max bigint := 62914560;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.bwf_assert_role(array['admin', 'uploader']);
  end if;

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if v_doc.parent_document_id is null and exists (
    select 1 from public.supplier_documents c where c.parent_document_id = v_doc.id
  ) then
    for v_child in
      select c.id from public.supplier_documents c
      where c.parent_document_id = v_doc.id
      order by c.part_index
    loop
      perform public.fds_supplier_document_enqueue_parse(v_child);
    end loop;
    update public.supplier_documents
    set status = 'parsing', error_message = null, modified_date = now()
    where id = v_doc.id;
    return jsonb_build_object('documentId', v_doc.id, 'jobId', null, 'alreadyQueued', false, 'split', true);
  end if;

  if v_doc.parent_document_id is null and coalesce(v_doc.file_size, 0) > v_edge_max then
    update public.processing_jobs
    set status = 'cancelled',
        error = 'redirected_to_split',
        finished_at = now(),
        updated_at = now()
    where document_id = v_doc.id
      and job_type = 'parse_pdf'
      and status in ('queued', 'running');

    select j.id into v_job_id
    from public.processing_jobs j
    where j.document_id = v_doc.id
      and j.job_type = 'needs_split'
      and j.status in ('queued', 'running')
    limit 1;

    if v_job_id is null then
      insert into public.processing_jobs (job_type, payload, document_id, creator_staff_id)
      values (
        'needs_split',
        jsonb_build_object('document_id', v_doc.id, 'storage_path', v_doc.storage_path, 'reason', 'over_edge_limit'),
        v_doc.id,
        v_staff
      )
      returning id into v_job_id;
    end if;

    update public.supplier_documents
    set status = 'parsing', error_message = null, modified_date = now()
    where id = v_doc.id;

    return jsonb_build_object('documentId', v_doc.id, 'jobId', v_job_id, 'alreadyQueued', false, 'needsSplit', true);
  end if;

  select j.id into v_job_id
  from public.processing_jobs j
  where j.document_id = p_document_id
    and j.job_type = 'parse_pdf'
    and j.status in ('queued', 'running')
  limit 1;

  if v_job_id is not null then
    return jsonb_build_object('documentId', p_document_id, 'jobId', v_job_id, 'alreadyQueued', true);
  end if;

  insert into public.processing_jobs (job_type, payload, document_id, creator_staff_id)
  values (
    'parse_pdf',
    jsonb_build_object('document_id', p_document_id, 'storage_path', v_doc.storage_path),
    p_document_id,
    v_staff
  )
  returning id into v_job_id;

  update public.supplier_documents
  set status = 'parsing',
      error_message = null,
      editor_staff_id = coalesce(v_staff, editor_staff_id),
      modified_date = now()
  where id = p_document_id;

  return jsonb_build_object('documentId', p_document_id, 'jobId', v_job_id, 'alreadyQueued', false);
end;
$$;

-- Edge 拿到超過 60MB 的 parse_pdf 時，結束該任務並改排 needs_split。不在 Edge 下載原檔。
create or replace function public.fds_supplier_document_redirect_to_split(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_doc public.supplier_documents%rowtype;
  v_split uuid;
  v_edge_max bigint := 62914560;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_job from public.processing_jobs where id = p_job_id and status = 'running' for update;
  if v_job.id is null then
    return jsonb_build_object('redirected', false);
  end if;

  select * into v_doc from public.supplier_documents where id = v_job.document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_doc.parent_document_id is not null then
    raise exception '分段仍超過 60MB，無法再拆' using errcode = '22023';
  end if;
  if coalesce(v_doc.file_size, 0) <= v_edge_max then
    raise exception 'not_oversized' using errcode = '22023';
  end if;

  update public.processing_jobs
  set status = 'succeeded',
      progress = 1,
      result = jsonb_build_object('redirected', 'needs_split'),
      error = null,
      finished_at = now(),
      heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id and status = 'running';

  if exists (select 1 from public.supplier_documents c where c.parent_document_id = v_doc.id) then
    return jsonb_build_object('redirected', false, 'reason', 'already_split');
  end if;

  select j.id into v_split
  from public.processing_jobs j
  where j.document_id = v_doc.id
    and j.job_type = 'needs_split'
    and j.status in ('queued', 'running')
  limit 1;

  if v_split is null then
    insert into public.processing_jobs (job_type, payload, document_id, creator_staff_id)
    values (
      'needs_split',
      jsonb_build_object('document_id', v_doc.id, 'storage_path', v_doc.storage_path, 'reason', 'over_edge_limit'),
      v_doc.id,
      v_job.creator_staff_id
    )
    returning id into v_split;
  end if;

  update public.supplier_documents
  set status = 'parsing', error_message = null, modified_date = now()
  where id = v_doc.id;

  return jsonb_build_object('redirected', true, 'jobId', v_split);
end;
$$;

-- 瀏覽器或 pdf-split worker 上傳分段後登記子文件，並各排一個 parse_pdf。
create or replace function public.fds_supplier_document_register_parts(
  p_parent_id uuid,
  p_parts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.supplier_documents%rowtype;
  v_part record;
  v_existing public.supplier_documents%rowtype;
  v_path text;
  v_hash text;
  v_size bigint;
  v_child uuid;
  v_title text;
  v_count int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    perform public.bwf_assert_role(array['admin', 'uploader']);
  end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) < 1 then
    raise exception 'parts_required' using errcode = '22023';
  end if;

  select * into v_parent from public.supplier_documents where id = p_parent_id for update;
  if v_parent.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if v_parent.parent_document_id is not null then
    raise exception 'nested_part' using errcode = '22023';
  end if;

  for v_part in
    select *
    from jsonb_to_recordset(p_parts) as x(
      part_index int,
      page_offset int,
      page_count int,
      storage_path text,
      content_hash text
    )
    order by part_index
  loop
    v_path := btrim(coalesce(v_part.storage_path, ''));
    v_hash := nullif(btrim(coalesce(v_part.content_hash, '')), '');
    if v_part.part_index is null or v_part.part_index < 1
      or v_part.page_offset is null or v_part.page_offset < 0
      or v_part.page_count is null or v_part.page_count < 1
      or v_path = '' then
      raise exception 'part_invalid' using errcode = '22023';
    end if;

    select (o.metadata ->> 'size')::bigint into v_size
    from storage.objects o
    where o.bucket_id = 'supplier-documents' and o.name = v_path;
    if v_size is null then
      raise exception 'storage_object_missing' using errcode = 'P0002';
    end if;

    select * into v_existing
    from public.supplier_documents
    where parent_document_id = v_parent.id and part_index = v_part.part_index;

    v_title := left(
      btrim(coalesce(v_parent.title, 'PDF'))
        || '（第 ' || (v_part.page_offset + 1)::text || '-' || (v_part.page_offset + v_part.page_count)::text || ' 頁）',
      300
    );

    if v_existing.id is not null
      and v_existing.storage_path = v_path
      and v_existing.page_offset = v_part.page_offset
      and v_existing.page_count = v_part.page_count
      and v_existing.status in ('parsing', 'review', 'ready') then
      v_count := v_count + 1;
      continue;
    end if;

    if v_existing.id is null then
      insert into public.supplier_documents (
        factory_id, factory_name, doc_type, title, storage_path, file_size, content_hash,
        page_count, currency, source, status, parent_document_id, part_index, page_offset,
        creator_staff_id, editor_staff_id
      ) values (
        v_parent.factory_id, v_parent.factory_name, v_parent.doc_type, v_title, v_path, v_size, v_hash,
        v_part.page_count, v_parent.currency, v_parent.source, 'uploaded', v_parent.id, v_part.part_index, v_part.page_offset,
        public.bwf_current_staff_id(), public.bwf_current_staff_id()
      )
      returning id into v_child;
    else
      update public.supplier_documents
      set title = v_title,
          storage_path = v_path,
          file_size = v_size,
          content_hash = v_hash,
          page_count = v_part.page_count,
          page_offset = v_part.page_offset,
          status = 'uploaded',
          error_message = null,
          modified_date = now()
      where id = v_existing.id
      returning id into v_child;
    end if;

    perform public.fds_supplier_document_enqueue_parse(v_child);
    v_count := v_count + 1;
  end loop;

  update public.processing_jobs
  set status = 'cancelled',
      error = 'split_in_browser',
      finished_at = now(),
      updated_at = now()
  where document_id = v_parent.id
    and job_type = 'needs_split'
    and status = 'queued';

  update public.supplier_documents p
  set page_count = greatest(
        coalesce(p.page_count, 0),
        coalesce((
          select max(c.page_offset + c.page_count)
          from public.supplier_documents c
          where c.parent_document_id = p.id
        ), 0)
      ),
      status = 'parsing',
      error_message = null,
      modified_date = now()
  where p.id = v_parent.id;

  return jsonb_build_object('documentId', v_parent.id, 'partCount', v_count);
end;
$$;

create or replace function public.fds_supplier_document_cancel_parts(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jobs int;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  update public.processing_jobs j
  set status = 'cancelled',
      finished_at = now(),
      updated_at = now()
  where j.status in ('queued', 'running')
    and (
      j.document_id = p_document_id
      or j.document_id in (
        select c.id from public.supplier_documents c where c.parent_document_id = p_document_id
      )
    );
  get diagnostics v_jobs = row_count;

  update public.supplier_documents
  set status = 'uploaded', error_message = null, modified_date = now()
  where status = 'parsing'
    and parent_document_id = p_document_id;

  if not exists (select 1 from public.supplier_documents c where c.parent_document_id = p_document_id) then
    update public.supplier_documents
    set status = 'uploaded', error_message = null, modified_date = now()
    where id = p_document_id and status = 'parsing';
  end if;

  return jsonb_build_object('documentId', p_document_id, 'cancelledJobs', v_jobs);
end;
$$;

-- 把子文件的頁、圖、分段、提取項抄到父文件，頁碼加上 page_offset。
-- 同一張圖（content_hash）跨段合併 seen_pages。交界上同一型號／名稱的待審項併成一筆。
create or replace function public.fds_supplier_document_merge_part(p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.supplier_documents%rowtype;
  v_child public.supplier_documents%rowtype;
  v_parent_id uuid;
  v_from int;
  v_to int;
  v_offset int;
  v_job uuid;
  v_seg public.supplier_document_segments%rowtype;
  v_page public.supplier_document_pages%rowtype;
  v_img public.supplier_document_images%rowtype;
  v_item public.extraction_items%rowtype;
  v_new_seg uuid;
  v_new_image uuid;
  v_seg_map jsonb := '{}'::jsonb;
  v_image_map jsonb := '{}'::jsonb;
  v_pages int[];
  v_neighbor record;
  v_earlier uuid;
  v_later uuid;
  v_split int;
  v_pair record;
  v_earlier_item public.extraction_items%rowtype;
  v_later_item public.extraction_items%rowtype;
  v_merged boolean;
  v_seg_a public.supplier_document_segments%rowtype;
  v_seg_b public.supplier_document_segments%rowtype;
  v_ident text;
  v_copied int := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select parent_document_id into v_parent_id
  from public.supplier_documents where id = p_child_id;
  if v_parent_id is null then
    return jsonb_build_object('merged', false, 'reason', 'not_a_part');
  end if;

  select * into v_parent from public.supplier_documents where id = v_parent_id for update;
  select * into v_child from public.supplier_documents where id = p_child_id for update;
  if v_child.id is null or v_parent.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  v_offset := coalesce(v_child.page_offset, 0);
  v_from := v_offset + 1;
  v_to := v_offset + coalesce(v_child.page_count, 0);
  if v_to < v_from then
    select coalesce(max(page_no), 0) + v_offset into v_to
    from public.supplier_document_pages where document_id = v_child.id;
  end if;

  select j.id into v_job
  from public.processing_jobs j
  where j.document_id = v_child.id and j.job_type = 'parse_pdf' and j.status = 'running'
  order by j.created_at desc
  limit 1;

  update public.supplier_document_images i
  set seen_pages = s.pages,
      page_occurrences = cardinality(s.pages),
      page_no = coalesce((select min(p) from unnest(s.pages) as p), i.page_no)
  from (
    select id,
      (
        select coalesce(array_agg(p order by p), '{}'::int[])
        from unnest(seen_pages) as p
        where p < v_from or p > v_to
      ) as pages
    from public.supplier_document_images
    where document_id = v_parent.id
      and seen_pages && (
        select coalesce(array_agg(g), '{}'::int[])
        from generate_series(v_from, v_to) as g
      )
  ) s
  where i.id = s.id;

  delete from public.supplier_document_images i
  where i.document_id = v_parent.id
    and cardinality(i.seen_pages) = 0
    and not exists (
      select 1 from public.extraction_items e
      where e.document_id = v_parent.id
        and e.status <> 'pending'
        and (e.main_image_id = i.id or i.id = any (e.image_ids))
    );

  delete from public.extraction_items
  where document_id = v_parent.id
    and source_part_id = v_child.id
    and status = 'pending'
    and imported_product_id is null;

  delete from public.supplier_document_segments
  where document_id = v_parent.id and source_part_id = v_child.id;

  delete from public.supplier_document_pages
  where document_id = v_parent.id
    and (source_part_id = v_child.id or (page_no >= v_from and page_no <= v_to));

  for v_seg in
    select * from public.supplier_document_segments
    where document_id = v_child.id
    order by seq
  loop
    insert into public.supplier_document_segments (
      document_id, job_id, seq, start_page, end_page, kind, title, page_types, source_part_id
    ) values (
      v_parent.id,
      v_job,
      v_child.part_index * 100000 + v_seg.seq,
      v_seg.start_page + v_offset,
      v_seg.end_page + v_offset,
      v_seg.kind,
      v_seg.title,
      v_seg.page_types,
      v_child.id
    )
    returning id into v_new_seg;
    v_seg_map := v_seg_map || jsonb_build_object(v_seg.id::text, v_new_seg::text);
  end loop;

  for v_page in
    select * from public.supplier_document_pages
    where document_id = v_child.id
    order by page_no
  loop
    insert into public.supplier_document_pages (
      document_id, job_id, page_no, text_source, content, char_count, image_count,
      ocr_status, ocr_error, page_type, page_title, continues_previous, classify_confidence,
      segment_id, source_part_id
    ) values (
      v_parent.id,
      v_job,
      v_page.page_no + v_offset,
      v_page.text_source,
      v_page.content,
      v_page.char_count,
      v_page.image_count,
      v_page.ocr_status,
      v_page.ocr_error,
      v_page.page_type,
      v_page.page_title,
      v_page.continues_previous,
      v_page.classify_confidence,
      nullif(v_seg_map ->> v_page.segment_id::text, '')::uuid,
      v_child.id
    );
  end loop;

  for v_img in
    select * from public.supplier_document_images where document_id = v_child.id
  loop
    select coalesce(array_agg(p + v_offset order by p), '{}'::int[])
      into v_pages
    from unnest(case when cardinality(v_img.seen_pages) > 0 then v_img.seen_pages else array[v_img.page_no] end) as p;

    insert into public.supplier_document_images as img (
      document_id, page_no, storage_path, public_url, width, height, byte_size,
      content_hash, page_occurrences, seen_pages, image_type, source_part_id
    ) values (
      v_parent.id,
      (select min(p) from unnest(v_pages) as p),
      v_img.storage_path,
      v_img.public_url,
      v_img.width,
      v_img.height,
      v_img.byte_size,
      v_img.content_hash,
      cardinality(v_pages),
      v_pages,
      case when cardinality(v_pages) >= 3 then 'logo' else v_img.image_type end,
      v_child.id
    )
    on conflict (document_id, content_hash) do update
      set seen_pages = (
            select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
            from unnest(coalesce(img.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
          ),
          page_occurrences = cardinality((
            select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
            from unnest(coalesce(img.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
          )),
          page_no = least(img.page_no, excluded.page_no),
          image_type = case
            when cardinality((
              select coalesce(array_agg(distinct t.v order by t.v), '{}'::int[])
              from unnest(coalesce(img.seen_pages, '{}'::int[]) || coalesce(excluded.seen_pages, '{}'::int[])) as t(v)
            )) >= 3 then 'logo'
            else img.image_type
          end
    returning id into v_new_image;
    v_image_map := v_image_map || jsonb_build_object(v_img.id::text, v_new_image::text);
  end loop;

  for v_item in
    select * from public.extraction_items
    where document_id = v_child.id and status = 'pending' and imported_product_id is null
    order by seq, page_no
  loop
    insert into public.extraction_items (
      job_id, document_id, segment_id, seq, page_no, page_end, bbox, raw_json, corrected_json,
      confidence, flags, needs_attention, main_image_id, image_ids, status, unit_item_key, source_part_id
    ) values (
      v_job,
      v_parent.id,
      nullif(v_seg_map ->> v_item.segment_id::text, '')::uuid,
      v_child.part_index * 100000 + v_item.seq,
      case when v_item.page_no is null then null else v_item.page_no + v_offset end,
      case when v_item.page_end is null then null else v_item.page_end + v_offset end,
      v_item.bbox,
      v_item.raw_json,
      v_item.corrected_json,
      v_item.confidence,
      v_item.flags,
      v_item.needs_attention,
      nullif(v_image_map ->> v_item.main_image_id::text, '')::uuid,
      (
        select coalesce(array_agg(m.mapped), '{}'::uuid[])
        from (
          select nullif(v_image_map ->> x::text, '')::uuid as mapped
          from unnest(v_item.image_ids) as x
        ) m
        where m.mapped is not null
      ),
      'pending',
      v_parent.id::text || ':part:' || v_child.id::text || ':' || coalesce(v_item.unit_item_key, v_item.id::text),
      v_child.id
    )
    on conflict (unit_item_key) do nothing;
    v_copied := v_copied + 1;
  end loop;

  for v_neighbor in
    select c.id, c.part_index, c.page_offset
    from public.supplier_documents c
    where c.parent_document_id = v_parent.id
      and c.part_index in (v_child.part_index - 1, v_child.part_index + 1)
  loop
    if v_neighbor.part_index < v_child.part_index then
      v_earlier := v_neighbor.id;
      v_later := v_child.id;
      v_split := v_child.page_offset + 1;
    else
      v_earlier := v_child.id;
      v_later := v_neighbor.id;
      v_split := v_neighbor.page_offset + 1;
    end if;
    v_merged := false;

    for v_pair in
      select e.id as earlier_id, l.id as later_id
      from public.extraction_items e
      join public.extraction_items l
        on l.document_id = v_parent.id
       and l.source_part_id = v_later
       and l.status = 'pending'
       and l.imported_product_id is null
       and l.page_no is not null
       and l.page_no <= v_split
      where e.document_id = v_parent.id
        and e.source_part_id = v_earlier
        and e.status = 'pending'
        and e.imported_product_id is null
        and e.page_no is not null
        and e.page_no < v_split
        and coalesce(e.page_end, e.page_no) >= v_split - 1
        and lower(btrim(coalesce(nullif(btrim(e.raw_json ->> 'model'), ''), nullif(btrim(e.raw_json ->> 'name'), ''), ''))) <> ''
        and lower(btrim(coalesce(nullif(btrim(e.raw_json ->> 'model'), ''), nullif(btrim(e.raw_json ->> 'name'), ''), '')))
          = lower(btrim(coalesce(nullif(btrim(l.raw_json ->> 'model'), ''), nullif(btrim(l.raw_json ->> 'name'), ''), '')))
    loop
      select * into v_earlier_item from public.extraction_items where id = v_pair.earlier_id;
      select * into v_later_item from public.extraction_items where id = v_pair.later_id;
      if v_earlier_item.id is null or v_later_item.id is null then
        continue;
      end if;
      update public.extraction_items
      set page_end = greatest(
            coalesce(v_earlier_item.page_end, v_earlier_item.page_no),
            coalesce(v_later_item.page_end, v_later_item.page_no)
          ),
          image_ids = (
            select coalesce(array_agg(distinct x), '{}'::uuid[])
            from unnest(coalesce(v_earlier_item.image_ids, '{}'::uuid[]) || coalesce(v_later_item.image_ids, '{}'::uuid[])) as x
          ),
          main_image_id = coalesce(v_earlier_item.main_image_id, v_later_item.main_image_id),
          flags = (
            select coalesce(array_agg(distinct f), '{}'::text[])
            from unnest(coalesce(v_earlier_item.flags, '{}'::text[]) || array['merged_across_parts']::text[]) as f
          ),
          updated_at = now()
      where id = v_earlier_item.id;
      delete from public.extraction_items where id = v_later_item.id and status = 'pending' and imported_product_id is null;
      v_merged := true;
    end loop;

    select * into v_seg_a
    from public.supplier_document_segments
    where document_id = v_parent.id and source_part_id = v_earlier and end_page = v_split - 1
    order by seq desc
    limit 1;
    select * into v_seg_b
    from public.supplier_document_segments
    where document_id = v_parent.id and source_part_id = v_later and start_page = v_split
    order by seq
    limit 1;
    v_ident := lower(btrim(coalesce(v_seg_a.title, '')));
    if v_seg_a.id is not null and v_seg_b.id is not null
      and v_seg_a.kind = v_seg_b.kind
      and v_seg_a.kind in ('product', 'price_table')
      and (v_merged or (v_ident <> '' and v_ident = lower(btrim(coalesce(v_seg_b.title, ''))))) then
      update public.supplier_document_segments
      set end_page = greatest(v_seg_a.end_page, v_seg_b.end_page),
          page_types = (
            select coalesce(array_agg(distinct t), '{}'::text[])
            from unnest(coalesce(v_seg_a.page_types, '{}'::text[]) || coalesce(v_seg_b.page_types, '{}'::text[])) as t
          )
      where id = v_seg_a.id;
      update public.supplier_document_pages set segment_id = v_seg_a.id where segment_id = v_seg_b.id;
      update public.extraction_items set segment_id = v_seg_a.id where segment_id = v_seg_b.id;
      delete from public.supplier_document_segments where id = v_seg_b.id;
    end if;
  end loop;

  update public.supplier_documents
  set page_count = greatest(
        coalesce(page_count, 0),
        coalesce((select max(page_no) from public.supplier_document_pages where document_id = v_parent.id), 0)
      ),
      modified_date = now()
  where id = v_parent.id;

  return jsonb_build_object('merged', true, 'parentId', v_parent.id, 'copied', v_copied);
end;
$$;

revoke all on function public.fds_supplier_document_enqueue_parse(uuid) from public, anon;
revoke all on function public.fds_supplier_document_redirect_to_split(uuid) from public, anon, authenticated;
revoke all on function public.fds_supplier_document_register_parts(uuid, jsonb) from public, anon;
revoke all on function public.fds_supplier_document_cancel_parts(uuid) from public, anon;
revoke all on function public.fds_supplier_document_merge_part(uuid) from public, anon, authenticated;

grant execute on function public.fds_supplier_document_enqueue_parse(uuid) to authenticated, service_role;
grant execute on function public.fds_supplier_document_redirect_to_split(uuid) to service_role;
grant execute on function public.fds_supplier_document_register_parts(uuid, jsonb) to authenticated, service_role;
grant execute on function public.fds_supplier_document_cancel_parts(uuid) to authenticated;
grant execute on function public.fds_supplier_document_merge_part(uuid) to service_role;

-- 已存放、超過 60MB、尚未拆段的原檔（例如目前 73.3MB 那份）改交 needs_split。
insert into public.processing_jobs (job_type, payload, document_id)
select
  'needs_split',
  jsonb_build_object('document_id', d.id, 'storage_path', d.storage_path, 'reason', 'over_edge_limit'),
  d.id
from public.supplier_documents d
where d.parent_document_id is null
  and d.file_size > 62914560
  and d.status in ('uploaded', 'parsing', 'failed')
  and not exists (
    select 1 from public.supplier_documents c where c.parent_document_id = d.id
  )
  and not exists (
    select 1 from public.processing_jobs j
    where j.document_id = d.id
      and j.job_type = 'needs_split'
      and j.status in ('queued', 'running')
  );

update public.processing_jobs j
set status = 'cancelled',
    error = 'redirected_to_split',
    finished_at = now(),
    updated_at = now()
from public.supplier_documents d
where j.document_id = d.id
  and j.job_type = 'parse_pdf'
  and j.status in ('queued', 'running')
  and d.parent_document_id is null
  and d.file_size > 62914560
  and not exists (
    select 1 from public.supplier_documents c where c.parent_document_id = d.id
  );

update public.supplier_documents d
set status = 'parsing',
    error_message = null,
    modified_date = now()
where d.parent_document_id is null
  and d.file_size > 62914560
  and d.status in ('uploaded', 'parsing', 'failed')
  and not exists (
    select 1 from public.supplier_documents c where c.parent_document_id = d.id
  )
  and exists (
    select 1 from public.processing_jobs j
    where j.document_id = d.id
      and j.job_type = 'needs_split'
      and j.status = 'queued'
  );

notify pgrst, 'reload schema';
