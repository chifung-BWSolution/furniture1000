-- FDS-26 補充：同廠家、同文件類型、同年份（source='asana'）多版本只保留最新版本。
-- 當同廠家同年份出現更新版本的 Asana 附件時：
-- 1. 取消舊版仍在 queued / running 的 processing_jobs
-- 2. 刪除舊版 Asana supplier_documents（未審核的 extraction_items 連帶移除；已入庫的 products 與 supplier_prices 保留）
-- 3. 將舊版 fds_asana_attachment_sync 標記為 skipped (superseded_by_newer_version)

alter table public.fds_asana_attachment_sync
  add column if not exists document_year int check (document_year is null or document_year between 1990 and 2100);

create index if not exists fds_asana_attachment_sync_ver_idx
  on public.fds_asana_attachment_sync (link_id, doc_type, document_year);

create or replace function public.fds_asana_document_ingest(
  p_link_id uuid,
  p_factory_id text,
  p_factory_name text,
  p_asana_task_gid text,
  p_asana_attachment_gid text,
  p_file_name text,
  p_file_ext text,
  p_storage_path text,
  p_file_size bigint default null,
  p_content_hash text default null,
  p_doc_type text default 'quote',
  p_remote_created_at timestamptz default null,
  p_document_year int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_factory_id text := nullif(btrim(coalesce(p_factory_id, '')), '');
  v_factory_name text := btrim(coalesce(p_factory_name, ''));
  v_ext text := lower(btrim(coalesce(p_file_ext, '')));
  v_doc_type text := case when p_doc_type in ('quote', 'catalog', 'price_list', 'certificate') then p_doc_type else 'quote' end;
  v_hash text := nullif(btrim(coalesce(p_content_hash, '')), '');
  v_size bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_job_type text;
  v_duplicate boolean := false;
  v_superseded_count int := 0;
  v_old_doc_ids uuid[];
  v_year int := greatest(
    1990,
    least(
      2100,
      coalesce(
        case when p_document_year between 1990 and 2100 then p_document_year else null end,
        extract(year from coalesce(p_remote_created_at, now()))::int
      )
    )
  );
  v_title text := left(regexp_replace(btrim(coalesce(p_file_name, '')), '\.(pdf|xlsx|xls)$', '', 'i'), 300);
begin
  if v_path = '' or v_factory_id is null or v_ext not in ('pdf', 'xlsx', 'xls') then
    raise exception 'invalid_asana_document_ingest' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_factory_id || ':' || v_doc_type || ':' || v_year::text, 0)
  );

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'supplier-documents' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;
  v_size := coalesce(v_size, p_file_size, 0);

  select id into v_doc_id
  from public.supplier_documents
  where storage_path = v_path
     or (
       v_hash is not null
       and factory_id = v_factory_id
       and doc_type = v_doc_type
       and content_hash = v_hash
       and parent_document_id is null
     )
  limit 1;

  if v_doc_id is not null then
    v_duplicate := true;
  else
    -- 找出同廠家、同類型、同年份的舊版 Asana 文件（只保留最新一份）
    select array_agg(d.id) into v_old_doc_ids
    from public.supplier_documents d
    where d.source = 'asana'
      and d.factory_id = v_factory_id
      and d.doc_type = v_doc_type
      and d.document_year = v_year
      and d.parent_document_id is null;

    if coalesce(array_length(v_old_doc_ids, 1), 0) > 0 then
      -- 取消舊版（含拆段子文件）仍在排隊或執行中的任務
      update public.processing_jobs j
      set status = 'cancelled',
          error = 'superseded_by_newer_version',
          finished_at = now(),
          updated_at = now()
      where j.status in ('queued', 'running')
        and (
          j.document_id = any(v_old_doc_ids)
          or j.document_id in (
            select c.id from public.supplier_documents c where c.parent_document_id = any(v_old_doc_ids)
          )
        );

      -- 標記舊版同步追蹤紀錄為已由新版取代
      update public.fds_asana_attachment_sync a
      set status = 'skipped',
          skip_reason = 'superseded_by_newer_version',
          document_id = null,
          updated_at = now()
      where a.document_id = any(v_old_doc_ids)
        and a.asana_attachment_gid <> p_asana_attachment_gid;

      -- 刪除舊版 Asana 文件（子文件與未審核 extraction_items 連帶刪除；已入庫 products 與 supplier_prices 保留）
      delete from public.supplier_documents
      where id = any(v_old_doc_ids);

      v_superseded_count := array_length(v_old_doc_ids, 1);
    end if;

    insert into public.supplier_documents (
      factory_id, factory_name, doc_type, title, storage_path, file_size,
      content_hash, source, status, document_year, description
    ) values (
      v_factory_id,
      coalesce(nullif(v_factory_name, ''), '未命名廠家'),
      v_doc_type,
      nullif(v_title, ''),
      v_path,
      v_size,
      v_hash,
      'asana',
      'uploaded',
      v_year,
      left('由 Asana 任務 ' || btrim(coalesce(p_asana_task_gid, '')) || ' 自動同步：' || btrim(coalesce(p_file_name, '')), 500)
    )
    returning id into v_doc_id;

    if v_ext in ('xlsx', 'xls') then
      v_job_type := 'parse_excel';
    elsif v_size > 62914560 then
      v_job_type := 'needs_split';
    else
      v_job_type := 'parse_pdf';
    end if;

    insert into public.processing_jobs (job_type, payload, document_id)
    values (
      v_job_type,
      jsonb_build_object(
        'document_id', v_doc_id,
        'storage_path', v_path,
        'file_ext', v_ext,
        'source', 'asana',
        'asana_task_gid', p_asana_task_gid,
        'asana_attachment_gid', p_asana_attachment_gid
      ) || case when v_job_type = 'needs_split' then jsonb_build_object('reason', 'over_edge_limit') else '{}'::jsonb end,
      v_doc_id
    )
    returning id into v_job_id;

    update public.supplier_documents
    set status = 'parsing',
        error_message = null,
        modified_date = now()
    where id = v_doc_id;
  end if;

  insert into public.fds_asana_attachment_sync (
    link_id, factory_id, asana_task_gid, asana_attachment_gid,
    file_name, file_ext, file_size, doc_type, document_year, remote_created_at,
    content_hash, document_id, status, skip_reason, error_message,
    attempts, synced_at, updated_at
  ) values (
    p_link_id, v_factory_id::uuid, p_asana_task_gid, p_asana_attachment_gid,
    left(btrim(p_file_name), 500), v_ext, v_size, v_doc_type, v_year, p_remote_created_at,
    v_hash, v_doc_id, 'synced',
    case when v_duplicate then 'duplicate_content' else null end,
    null, 1, now(), now()
  )
  on conflict (asana_attachment_gid) do update
    set document_id = excluded.document_id,
        document_year = excluded.document_year,
        content_hash = coalesce(excluded.content_hash, public.fds_asana_attachment_sync.content_hash),
        file_size = coalesce(excluded.file_size, public.fds_asana_attachment_sync.file_size),
        doc_type = excluded.doc_type,
        status = 'synced',
        skip_reason = excluded.skip_reason,
        error_message = null,
        attempts = public.fds_asana_attachment_sync.attempts + 1,
        synced_at = now(),
        updated_at = now();

  return jsonb_build_object(
    'documentId', v_doc_id,
    'jobId', v_job_id,
    'jobType', v_job_type,
    'documentYear', v_year,
    'duplicate', v_duplicate,
    'superseded', v_superseded_count
  );
end;
$$;

drop function if exists public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz);
revoke all on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz, int) to service_role;

-- 同步更新 mark RPC 記錄 document_year
create or replace function public.fds_asana_attachment_mark(
  p_link_id uuid,
  p_factory_id uuid,
  p_asana_task_gid text,
  p_asana_attachment_gid text,
  p_file_name text,
  p_file_ext text,
  p_file_size bigint default null,
  p_doc_type text default 'quote',
  p_remote_created_at timestamptz default null,
  p_status text default 'failed',
  p_skip_reason text default null,
  p_error text default null,
  p_document_year int default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case when p_status in ('pending', 'synced', 'skipped', 'failed') then p_status else 'failed' end;
  v_ext text := case when lower(coalesce(p_file_ext, '')) in ('pdf', 'xlsx', 'xls') then lower(p_file_ext) else 'pdf' end;
  v_doc_type text := case when p_doc_type in ('quote', 'catalog', 'price_list', 'certificate') then p_doc_type else 'quote' end;
  v_year int := case when p_document_year between 1990 and 2100 then p_document_year else null end;
begin
  insert into public.fds_asana_attachment_sync (
    link_id, factory_id, asana_task_gid, asana_attachment_gid,
    file_name, file_ext, file_size, doc_type, document_year, remote_created_at,
    status, skip_reason, error_message, attempts, updated_at
  ) values (
    p_link_id, p_factory_id, p_asana_task_gid, p_asana_attachment_gid,
    left(coalesce(nullif(btrim(p_file_name), ''), p_asana_attachment_gid), 500),
    v_ext, p_file_size, v_doc_type, v_year, p_remote_created_at,
    v_status, left(p_skip_reason, 100), left(p_error, 1000), 1, now()
  )
  on conflict (asana_attachment_gid) do update
    set status = excluded.status,
        document_year = coalesce(excluded.document_year, public.fds_asana_attachment_sync.document_year),
        skip_reason = excluded.skip_reason,
        error_message = excluded.error_message,
        attempts = public.fds_asana_attachment_sync.attempts + 1,
        updated_at = now();
end;
$$;

drop function if exists public.fds_asana_attachment_mark(uuid, uuid, text, text, text, text, bigint, text, timestamptz, text, text, text);
revoke all on function public.fds_asana_attachment_mark(uuid, uuid, text, text, text, text, bigint, text, timestamptz, text, text, text, int) from public, anon, authenticated;
grant execute on function public.fds_asana_attachment_mark(uuid, uuid, text, text, text, text, bigint, text, timestamptz, text, text, text, int) to service_role;

notify pgrst, 'reload schema';
