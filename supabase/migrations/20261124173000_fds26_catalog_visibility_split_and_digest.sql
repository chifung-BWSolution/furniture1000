-- FDS-26 修復：
-- 1. fds_list_quote_catalogs 移除 status <> 'failed'，讓原檔完好的圖冊即使 AI 解析失敗仍可於報價附件選擇。
-- 2. 主文件拆檔門檻由 60MB (62914560) 降至 20MB (20971520)，避免 25–60MB 圖冊在 Edge parse_pdf 逾時失敗。
-- 3. fds_asana_document_ingest 移除「按廠家＋類型＋年份刪除舊文件」的邏輯，避免同廠家同年不同系列圖冊被互相覆蓋；保留同 storage_path / content_hash 去重。
-- 4. 建立 fds_document_parse_digest_runs 與每日 09:15 HKT（01:15 UTC）cron 排程，寄送解析進度報告給 cfb.system@chifung.net。

-- ── 1. 報價「圖冊附件」選擇器：不再隱藏解析失敗的圖冊 ────────────────────

create or replace function public.fds_list_quote_catalogs(p_query text default null)
returns jsonb
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

-- ── 2. 拆檔門檻降至 20MB（enqueue_parse & redirect_to_split） ────────────

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
  v_split_trigger bigint := 20971520;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader']) then
    if not public.bwf_has_role(array['supplier']) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
    select * into v_doc from public.supplier_documents where id = p_document_id;
    if v_doc.id is null then
      raise exception 'document_not_found' using errcode = 'P0002';
    end if;
    if v_doc.factory_id is null
       or v_doc.factory_id <> all(public.fds_supplier_factory_identifiers()) then
      raise exception 'permission_denied' using errcode = '42501';
    end if;
  end if;

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;

  if v_doc.doc_type = 'certificate' then
    raise exception 'certificate_not_parseable' using errcode = '22023';
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

  if v_doc.parent_document_id is null and coalesce(v_doc.file_size, 0) > v_split_trigger then
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
  v_split_trigger bigint := 20971520;
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
    raise exception '分段仍超過上限，無法再拆' using errcode = '22023';
  end if;
  if coalesce(v_doc.file_size, 0) <= v_split_trigger then
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

-- ── 3. fds_asana_document_ingest：不刪除不同系列文件，並用 20MB 觸發拆檔 ─

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
  p_document_year int default null,
  p_factory_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_factory_uuid text := nullif(btrim(coalesce(p_factory_id, '')), '');
  v_doc_factory_key text := coalesce(nullif(upper(btrim(coalesce(p_factory_code, ''))), ''), v_factory_uuid);
  v_factory_name text := btrim(coalesce(p_factory_name, ''));
  v_ext text := lower(btrim(coalesce(p_file_ext, '')));
  v_doc_type text := case when p_doc_type in ('quote', 'catalog', 'price_list', 'certificate') then p_doc_type else 'quote' end;
  v_hash text := nullif(btrim(coalesce(p_content_hash, '')), '');
  v_size bigint;
  v_doc_id uuid;
  v_job_id uuid;
  v_job_type text;
  v_duplicate boolean := false;
  v_split_trigger bigint := 20971520;
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
  if v_path = '' or v_factory_uuid is null or v_ext not in ('pdf', 'xlsx', 'xls') then
    raise exception 'invalid_asana_document_ingest' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_doc_factory_key || ':' || v_doc_type || ':' || coalesce(v_hash, v_path), 0)
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
       and factory_id in (v_doc_factory_key, v_factory_uuid)
       and doc_type = v_doc_type
       and content_hash = v_hash
       and parent_document_id is null
     )
  limit 1;

  if v_doc_id is not null then
    v_duplicate := true;
  else
    insert into public.supplier_documents (
      factory_id, factory_name, doc_type, title, storage_path, file_size,
      content_hash, source, status, document_year, description
    ) values (
      v_doc_factory_key,
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
    elsif v_size > v_split_trigger then
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
    p_link_id, v_factory_uuid::uuid, p_asana_task_gid, p_asana_attachment_gid,
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
    'factoryKey', v_doc_factory_key,
    'duplicate', v_duplicate,
    'superseded', 0
  );
end;
$$;

-- ── 4. 每日圖冊／報價單夜間解析進度郵件紀錄表與排程 ──────────────────────

create table if not exists public.fds_document_parse_digest_runs (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  recipient text not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped_no_activity')),
  provider text,
  provider_id text,
  docs_total int not null default 0,
  docs_completed int not null default 0,
  docs_failed int not null default 0,
  items_extracted int not null default 0,
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_date, recipient)
);

comment on table public.fds_document_parse_digest_runs is
  '每日 09:15 HKT 圖冊／報價單夜間解析進度電郵冪等紀錄';

create index if not exists fds_document_parse_digest_runs_date_idx
  on public.fds_document_parse_digest_runs (report_date desc);

alter table public.fds_document_parse_digest_runs enable row level security;
revoke all on table public.fds_document_parse_digest_runs from public, anon, authenticated;
grant all on table public.fds_document_parse_digest_runs to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $cron$
declare
  v_host text;
  v_command text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname = 'fds-process-jobs'
  limit 1;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  perform cron.unschedule(j.jobid)
  from cron.job as j
  where j.jobname = 'fds-document-parse-daily-digest';

  if v_host = 'https://riaubhtruisbwdlwjzur.supabase.co' then
    v_command := format($job$
      SELECT net.http_post(
        url := %L || '/functions/v1/send-document-parse-digest',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'fds_worker_secret'
            LIMIT 1
          )
        ),
        body := '{"source":"cron"}'::jsonb,
        timeout_milliseconds := 20000
      ) AS request_id;
    $job$, v_host);

    -- UTC 01:15 = HKT 09:15（每日夜間解析視窗 23:00-09:00 結束後）
    perform cron.schedule('fds-document-parse-daily-digest', '15 1 * * *', v_command);
  end if;
end;
$cron$;

notify pgrst, 'reload schema';
