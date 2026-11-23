-- FDS-26：Asana 供應商報價單與傢俬圖冊定時同步（PDF + Excel）。
-- 沿用既有 fds_asana_factory_link（PMS factories.asana_link）與 FDS 2.1 supplier_documents / processing_jobs 管線。
-- 不修改 PMS 既有表與契約；AI 解析結果一律進入 extraction_items 待審核（BR-02）。

-- ── 1. Storage bucket 允許 Excel（.xlsx / .xls）與 PDF ───────────────────

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]
where id = 'supplier-documents';

-- ── 2. supplier_documents 擴充 source='asana' ────────────────────────────

alter table public.supplier_documents
  drop constraint if exists supplier_documents_source_check;
alter table public.supplier_documents
  add constraint supplier_documents_source_check
  check (source in ('upload', 'ai_processor', 'asana'));

alter table public.supplier_documents
  drop constraint if exists supplier_documents_catalog_meta_chk;
alter table public.supplier_documents
  add constraint supplier_documents_catalog_meta_chk check (
    parent_document_id is not null or document_year is null or (
      document_year between 1990 and 2100 and (
        doc_type <> 'catalog' or source in ('ai_processor', 'asana') or (
          length(btrim(coalesce(series, ''))) > 0 and cardinality(product_categories) > 0
        )
      )
    )
  );

-- ── 3. fds_asana_factory_link 記錄附件上次同步時間 ───────────────────────

alter table public.fds_asana_factory_link
  add column if not exists attachments_synced_at timestamptz;

create index if not exists fds_asana_factory_link_att_sync_idx
  on public.fds_asana_factory_link (attachments_synced_at asc nulls first)
  where enabled is true;

-- ── 4. 附件同步追蹤表 fds_asana_attachment_sync ──────────────────────────

create table if not exists public.fds_asana_attachment_sync (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.fds_asana_factory_link(id) on delete cascade,
  factory_id uuid not null,
  asana_task_gid text not null,
  asana_attachment_gid text not null unique,
  file_name text not null,
  file_ext text not null check (file_ext in ('pdf', 'xlsx', 'xls')),
  file_size bigint check (file_size is null or file_size >= 0),
  doc_type text not null default 'quote' check (doc_type in ('quote', 'catalog', 'price_list', 'certificate')),
  remote_created_at timestamptz,
  content_hash text,
  document_id uuid references public.supplier_documents(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'synced', 'skipped', 'failed')),
  skip_reason text,
  error_message text,
  attempts int not null default 0 check (attempts >= 0),
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fds_asana_att_file_name_len check (char_length(file_name) between 1 and 500)
);

create index if not exists fds_asana_attachment_sync_link_idx
  on public.fds_asana_attachment_sync (link_id, created_at desc);
create index if not exists fds_asana_attachment_sync_status_idx
  on public.fds_asana_attachment_sync (status, updated_at desc);

alter table public.fds_asana_attachment_sync enable row level security;
revoke all on table public.fds_asana_attachment_sync from public, anon, authenticated;
grant select on table public.fds_asana_attachment_sync to authenticated;
grant all on table public.fds_asana_attachment_sync to service_role;

drop policy if exists "fds_asana_attachment_sync_select_staff" on public.fds_asana_attachment_sync;
create policy "fds_asana_attachment_sync_select_staff"
  on public.fds_asana_attachment_sync for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

-- ── 5. Service-role 匯入 RPC：登記 supplier_documents 並排入解析任務 ─────

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
  p_remote_created_at timestamptz default null
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
  v_year int := greatest(1990, least(2100, extract(year from coalesce(p_remote_created_at, now()))::int));
  v_title text := left(regexp_replace(btrim(coalesce(p_file_name, '')), '\.(pdf|xlsx|xls)$', '', 'i'), 300);
begin
  if v_path = '' or v_factory_id is null or v_ext not in ('pdf', 'xlsx', 'xls') then
    raise exception 'invalid_asana_document_ingest' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_factory_id || ':' || v_doc_type || ':' || coalesce(v_hash, v_path), 0)
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
    file_name, file_ext, file_size, doc_type, remote_created_at,
    content_hash, document_id, status, skip_reason, error_message,
    attempts, synced_at, updated_at
  ) values (
    p_link_id, v_factory_id::uuid, p_asana_task_gid, p_asana_attachment_gid,
    left(btrim(p_file_name), 500), v_ext, v_size, v_doc_type, p_remote_created_at,
    v_hash, v_doc_id, 'synced',
    case when v_duplicate then 'duplicate_content' else null end,
    null, 1, now(), now()
  )
  on conflict (asana_attachment_gid) do update
    set document_id = excluded.document_id,
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
    'duplicate', v_duplicate
  );
end;
$$;

revoke all on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.fds_asana_document_ingest(uuid, text, text, text, text, text, text, text, bigint, text, text, timestamptz) to service_role;

-- ── 6. Service-role 狀態記錄 RPC（skipped / failed） ─────────────────────

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
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case when p_status in ('pending', 'synced', 'skipped', 'failed') then p_status else 'failed' end;
  v_ext text := case when lower(coalesce(p_file_ext, '')) in ('pdf', 'xlsx', 'xls') then lower(p_file_ext) else 'pdf' end;
  v_doc_type text := case when p_doc_type in ('quote', 'catalog', 'price_list', 'certificate') then p_doc_type else 'quote' end;
begin
  insert into public.fds_asana_attachment_sync (
    link_id, factory_id, asana_task_gid, asana_attachment_gid,
    file_name, file_ext, file_size, doc_type, remote_created_at,
    status, skip_reason, error_message, attempts, updated_at
  ) values (
    p_link_id, p_factory_id, p_asana_task_gid, p_asana_attachment_gid,
    left(coalesce(nullif(btrim(p_file_name), ''), p_asana_attachment_gid), 500),
    v_ext, p_file_size, v_doc_type, p_remote_created_at,
    v_status, left(p_skip_reason, 100), left(p_error, 1000), 1, now()
  )
  on conflict (asana_attachment_gid) do update
    set status = excluded.status,
        skip_reason = excluded.skip_reason,
        error_message = excluded.error_message,
        attempts = public.fds_asana_attachment_sync.attempts + 1,
        updated_at = now();
end;
$$;

revoke all on function public.fds_asana_attachment_mark(uuid, uuid, text, text, text, text, bigint, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.fds_asana_attachment_mark(uuid, uuid, text, text, text, text, bigint, text, timestamptz, text, text, text) to service_role;

-- ── 7. 前端查詢 RPC：列出廠家已同步的 Asana 附件 ─────────────────────────

create or replace function public.fds_asana_attachment_sync_list(
  p_link_id uuid,
  p_limit int default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(row_data) order by row_data.sort_at desc)
    from (
      select
        a.id,
        a.asana_attachment_gid,
        a.file_name,
        a.file_ext,
        a.file_size,
        a.doc_type,
        a.status,
        a.skip_reason,
        a.error_message,
        a.document_id,
        a.remote_created_at,
        a.synced_at,
        d.status as document_status,
        d.error_message as document_error,
        j.job_type as latest_job_type,
        j.status as latest_job_status,
        j.progress as latest_job_progress,
        coalesce(a.synced_at, a.updated_at, a.created_at) as sort_at
      from public.fds_asana_attachment_sync a
      left join public.supplier_documents d on d.id = a.document_id
      left join lateral (
        select pj.job_type, pj.status, pj.progress
        from public.processing_jobs pj
        where pj.document_id = a.document_id
        order by pj.created_at desc
        limit 1
      ) j on a.document_id is not null
      where a.link_id = p_link_id
      order by coalesce(a.synced_at, a.updated_at, a.created_at) desc
      limit v_limit
    ) row_data
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_asana_attachment_sync_list(uuid, int) from public, anon;
grant execute on function public.fds_asana_attachment_sync_list(uuid, int) to authenticated;

-- ── 8. pg_cron：每小時（:15）增量同步 Asana 供應商附件 ───────────────────

do $cron$
declare
  v_host text;
  v_cmd text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname = 'fds-process-jobs'
  limit 1;

  if v_host is null or v_host = '' then
    select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
      into v_host
    from cron.job
    where jobname = 'fds-sync-asana-factories'
    limit 1;
  end if;

  if v_host is null or v_host = '' then
    v_host := 'https://riaubhtruisbwdlwjzur.supabase.co';
  end if;

  v_cmd := format($job$
    select net.http_post(
      url := %L || '/functions/v1/sync-asana-documents',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron","factory_limit":10,"files_per_factory":3}'::jsonb,
      timeout_milliseconds := 5000
    )
    where exists (
      select 1 from public.fds_asana_factory_link l where l.enabled
    );
  $job$, v_host);

  perform cron.unschedule(jobid) from cron.job where jobname = 'fds-sync-asana-documents';
  perform cron.schedule('fds-sync-asana-documents', '15 * * * *', v_cmd);
end
$cron$;

notify pgrst, 'reload schema';
