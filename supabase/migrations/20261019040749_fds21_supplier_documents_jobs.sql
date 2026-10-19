-- FDS 2.1 Day 1（T-000 / T-102 / T-104）：
--   角色斷言、supplier_documents（原始 PDF）、processing_jobs（通用背景任務）、
--   私有 bucket supplier-documents、worker RPC 與 pg_cron 觸發。
-- 供應商主檔仍在 PMS factories；這裡只記 factory_id / factory_name。
-- 新表不開 allow-all：只讓 admin / uploader 讀，寫入一律經 SECURITY DEFINER RPC。

-- ── 角色 ──────────────────────────────────────────────────────────────

create or replace function public.bwf_has_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.platform_user_profiles p
    where p.active is true
      and lower(p.role) = any (p_roles)
      and (
        p.auth_user_id = auth.uid()
        or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

create or replace function public.bwf_assert_role(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(p_roles) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
end;
$$;

-- PMS public.staff.id of the caller (same value pmsAudit writes from the client).
create or replace function public.bwf_current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.staff_id
  from public.platform_user_profiles p
  where p.active is true
    and (
      p.auth_user_id = auth.uid()
      or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  order by (p.auth_user_id = auth.uid()) desc nulls last, p.updated_at desc nulls last
  limit 1;
$$;

revoke all on function public.bwf_has_role(text[]) from public, anon;
revoke all on function public.bwf_assert_role(text[]) from public, anon;
revoke all on function public.bwf_current_staff_id() from public, anon;
grant execute on function public.bwf_has_role(text[]) to authenticated;
grant execute on function public.bwf_assert_role(text[]) to authenticated;
grant execute on function public.bwf_current_staff_id() to authenticated;

-- ── supplier_documents ────────────────────────────────────────────────

create table if not exists public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  factory_id text,
  factory_name text not null default '',
  doc_type text not null default 'quote' check (doc_type in ('quote', 'catalog')),
  title text,
  storage_path text not null unique,
  file_size bigint check (file_size is null or file_size >= 0),
  content_hash text,
  page_count int check (page_count is null or page_count >= 0),
  currency text,
  source text not null default 'upload' check (source in ('upload', 'ai_processor')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsing', 'review', 'ready', 'failed')),
  error_message text,
  creator_staff_id uuid,
  editor_staff_id uuid,
  created_date timestamptz not null default now(),
  modified_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint supplier_documents_title_len check (title is null or char_length(title) <= 300),
  constraint supplier_documents_currency_len check (currency is null or char_length(currency) <= 10)
);

create index if not exists supplier_documents_factory_idx
  on public.supplier_documents (factory_id, created_at desc);
create index if not exists supplier_documents_status_idx
  on public.supplier_documents (status, created_at desc);
create index if not exists supplier_documents_hash_idx
  on public.supplier_documents (content_hash) where content_hash is not null;

alter table public.supplier_documents enable row level security;
revoke all on public.supplier_documents from public, anon, authenticated;
grant select on public.supplier_documents to authenticated;
grant all on public.supplier_documents to service_role;

drop policy if exists "supplier_documents_read_admin_uploader" on public.supplier_documents;
create policy "supplier_documents_read_admin_uploader"
  on public.supplier_documents for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

-- ── processing_jobs ───────────────────────────────────────────────────

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null check (job_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  document_id uuid references public.supplier_documents(id) on delete set null,
  progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  idempotency_key text unique,
  run_after timestamptz not null default now(),
  heartbeat_at timestamptz,
  worker text,
  pages int check (pages is null or pages >= 0),
  ocr_pages int check (ocr_pages is null or ocr_pages >= 0),
  tokens bigint check (tokens is null or tokens >= 0),
  cost_estimate numeric check (cost_estimate is null or cost_estimate >= 0),
  cost_actual numeric check (cost_actual is null or cost_actual >= 0),
  error text,
  error_log jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  creator_staff_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists processing_jobs_queue_idx
  on public.processing_jobs (job_type, run_after)
  where status = 'queued';
create index if not exists processing_jobs_running_idx
  on public.processing_jobs (job_type, heartbeat_at)
  where status = 'running';
create index if not exists processing_jobs_document_idx
  on public.processing_jobs (document_id, created_at desc);
-- One live job per (document, type): re-parse cannot stack duplicate work.
create unique index if not exists processing_jobs_one_active_per_document
  on public.processing_jobs (document_id, job_type)
  where document_id is not null and status in ('queued', 'running');

alter table public.processing_jobs enable row level security;
revoke all on public.processing_jobs from public, anon, authenticated;
grant select on public.processing_jobs to authenticated;
grant all on public.processing_jobs to service_role;

drop policy if exists "processing_jobs_read_admin_uploader" on public.processing_jobs;
create policy "processing_jobs_read_admin_uploader"
  on public.processing_jobs for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

-- ── Storage：私有 bucket supplier-documents ───────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-documents', 'supplier-documents', false, 209715200, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "supplier_documents_objects_insert" on storage.objects;
create policy "supplier_documents_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

drop policy if exists "supplier_documents_objects_select" on storage.objects;
create policy "supplier_documents_objects_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

-- ── 前端 RPC ──────────────────────────────────────────────────────────

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
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  select * into v_doc from public.supplier_documents where id = p_document_id for update;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
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

create or replace function public.fds_supplier_document_create(
  p_storage_path text,
  p_factory_id text default null,
  p_factory_name text default null,
  p_title text default null,
  p_doc_type text default 'quote',
  p_currency text default null,
  p_content_hash text default null,
  p_source text default 'upload',
  p_enqueue boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_size bigint;
  v_doc_id uuid;
  v_staff uuid := public.bwf_current_staff_id();
  v_enqueue jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if v_path = '' then
    raise exception 'storage_path_required' using errcode = '22023';
  end if;

  -- Same object path (path is derived from factory + content hash) = same upload.
  select id into v_doc_id from public.supplier_documents where storage_path = v_path;
  if v_doc_id is not null then
    return jsonb_build_object('documentId', v_doc_id, 'jobId', null, 'duplicate', true);
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'supplier-documents' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  insert into public.supplier_documents (
    factory_id, factory_name, doc_type, title, storage_path, file_size, content_hash,
    currency, source, status, creator_staff_id, editor_staff_id
  ) values (
    nullif(btrim(coalesce(p_factory_id, '')), ''),
    btrim(coalesce(p_factory_name, '')),
    case when p_doc_type = 'catalog' then 'catalog' else 'quote' end,
    nullif(left(btrim(coalesce(p_title, '')), 300), ''),
    v_path,
    v_size,
    nullif(btrim(coalesce(p_content_hash, '')), ''),
    nullif(upper(left(btrim(coalesce(p_currency, '')), 10)), ''),
    case when p_source = 'ai_processor' then 'ai_processor' else 'upload' end,
    'uploaded',
    v_staff,
    v_staff
  )
  returning id into v_doc_id;

  if coalesce(p_enqueue, true) then
    v_enqueue := public.fds_supplier_document_enqueue_parse(v_doc_id);
    return jsonb_build_object('documentId', v_doc_id, 'jobId', v_enqueue ->> 'jobId', 'duplicate', false);
  end if;

  return jsonb_build_object('documentId', v_doc_id, 'jobId', null, 'duplicate', false);
end;
$$;

create or replace function public.fds_supplier_document_update(
  p_document_id uuid,
  p_title text default null,
  p_currency text default null,
  p_doc_type text default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  update public.supplier_documents
  set title = case when p_title is null then title else nullif(left(btrim(p_title), 300), '') end,
      currency = case when p_currency is null then currency else nullif(upper(left(btrim(p_currency), 10)), '') end,
      doc_type = case when p_doc_type in ('quote', 'catalog') then p_doc_type else doc_type end,
      editor_staff_id = coalesce(public.bwf_current_staff_id(), editor_staff_id),
      modified_date = now()
  where id = p_document_id;

  if not found then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.fds_processing_job_cancel(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  update public.processing_jobs
  set status = 'cancelled',
      finished_at = now(),
      updated_at = now()
  where id = p_job_id and status in ('queued', 'running')
  returning * into v_job;

  if v_job.id is null then
    return jsonb_build_object('jobId', p_job_id, 'cancelled', false);
  end if;

  if v_job.document_id is not null then
    update public.supplier_documents
    set status = 'uploaded',
        error_message = null,
        editor_staff_id = coalesce(public.bwf_current_staff_id(), editor_staff_id),
        modified_date = now()
    where id = v_job.document_id and status = 'parsing';
  end if;

  return jsonb_build_object('jobId', p_job_id, 'cancelled', true);
end;
$$;

revoke all on function public.fds_supplier_document_enqueue_parse(uuid) from public, anon;
revoke all on function public.fds_supplier_document_create(text, text, text, text, text, text, text, text, boolean) from public, anon;
revoke all on function public.fds_supplier_document_update(uuid, text, text, text) from public, anon;
revoke all on function public.fds_processing_job_cancel(uuid) from public, anon;
grant execute on function public.fds_supplier_document_enqueue_parse(uuid) to authenticated;
grant execute on function public.fds_supplier_document_create(text, text, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.fds_supplier_document_update(uuid, text, text, text) to authenticated;
grant execute on function public.fds_processing_job_cancel(uuid) to authenticated;

-- ── Worker RPC（service_role only）────────────────────────────────────

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'fds_worker_secret',
  'Shared secret between pg_cron and the process-jobs edge function'
)
where not exists (select 1 from vault.secrets where name = 'fds_worker_secret');

create or replace function public.fds_worker_verify_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_secret, '') <> '' and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'fds_worker_secret' and s.decrypted_secret = p_secret
  );
$$;

create or replace function public.fds_processing_jobs_claim(
  p_job_types text[],
  p_limit int default 1,
  p_worker text default null,
  p_max_running int default 3,
  p_stale_after interval default interval '10 minutes'
) returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slots int;
begin
  -- Jobs whose worker died after the last allowed attempt: stop retrying.
  with dead as (
    update public.processing_jobs
    set status = 'failed',
        error = coalesce(error, 'worker_timeout'),
        error_log = error_log || jsonb_build_array(jsonb_build_object(
          'at', now(), 'attempt', attempts, 'error', 'worker_timeout')),
        finished_at = now(),
        updated_at = now()
    where status = 'running'
      and job_type = any (p_job_types)
      and heartbeat_at < now() - p_stale_after
      and attempts >= max_attempts
    returning document_id
  )
  update public.supplier_documents d
  set status = 'failed', error_message = 'worker_timeout', modified_date = now()
  from dead
  where d.id = dead.document_id;

  select greatest(0, p_max_running - count(*))::int into v_slots
  from public.processing_jobs
  where status = 'running'
    and job_type = any (p_job_types)
    and heartbeat_at >= now() - p_stale_after;

  return query
  with claimed as (
    update public.processing_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        started_at = coalesce(j.started_at, now()),
        heartbeat_at = now(),
        worker = p_worker,
        error = null,
        updated_at = now()
    where j.id in (
      select c.id
      from public.processing_jobs c
      where c.job_type = any (p_job_types)
        and c.attempts < c.max_attempts
        and (
          (c.status = 'queued' and c.run_after <= now())
          or (c.status = 'running' and c.heartbeat_at < now() - p_stale_after)
        )
      order by c.run_after, c.created_at
      limit least(greatest(coalesce(p_limit, 1), 0), v_slots)
      for update skip locked
    )
    returning j.*
  )
  select * from claimed;
end;
$$;

-- Returns the job's current status so the worker can stop when it was cancelled.
create or replace function public.fds_processing_job_heartbeat(
  p_job_id uuid,
  p_progress numeric default null
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.processing_jobs
  set heartbeat_at = now(),
      progress = coalesce(least(greatest(p_progress, 0), 1), progress),
      updated_at = now()
  where id = p_job_id and status = 'running'
  returning status into v_status;

  if v_status is null then
    select status into v_status from public.processing_jobs where id = p_job_id;
  end if;
  return v_status;
end;
$$;

create or replace function public.fds_processing_job_complete(
  p_job_id uuid,
  p_result jsonb default null,
  p_document_status text default null,
  p_pages int default null,
  p_ocr_pages int default null,
  p_tokens bigint default null,
  p_cost_actual numeric default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  update public.processing_jobs
  set status = 'succeeded',
      progress = 1,
      result = p_result,
      pages = coalesce(p_pages, pages),
      ocr_pages = coalesce(p_ocr_pages, ocr_pages),
      tokens = coalesce(p_tokens, tokens),
      cost_actual = coalesce(p_cost_actual, cost_actual),
      error = null,
      finished_at = now(),
      heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id and status = 'running'
  returning * into v_job;

  if v_job.id is null then
    return false;
  end if;

  if v_job.document_id is not null and p_document_status in ('uploaded', 'parsing', 'review', 'ready', 'failed') then
    update public.supplier_documents
    set status = p_document_status,
        page_count = coalesce(p_pages, page_count),
        error_message = null,
        modified_date = now()
    where id = v_job.document_id;
  end if;

  return true;
end;
$$;

create or replace function public.fds_processing_job_fail(
  p_job_id uuid,
  p_error text,
  p_retryable boolean default true
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown_error'), 2000);
  v_retry boolean;
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.status <> 'running' then
    return coalesce(v_job.status, 'missing');
  end if;

  v_retry := coalesce(p_retryable, true) and v_job.attempts < v_job.max_attempts;

  update public.processing_jobs
  set status = case when v_retry then 'queued' else 'failed' end,
      error = v_error,
      error_log = error_log || jsonb_build_array(jsonb_build_object(
        'at', now(), 'attempt', attempts, 'error', v_error, 'retry', v_retry)),
      run_after = case
        when v_retry then now() + make_interval(secs => 30 * power(2, greatest(attempts - 1, 0)))
        else run_after
      end,
      finished_at = case when v_retry then null else now() end,
      updated_at = now()
  where id = p_job_id;

  if not v_retry and v_job.document_id is not null then
    update public.supplier_documents
    set status = 'failed', error_message = v_error, modified_date = now()
    where id = v_job.document_id;
  end if;

  return case when v_retry then 'queued' else 'failed' end;
end;
$$;

revoke all on function public.fds_worker_verify_secret(text) from public, anon, authenticated;
revoke all on function public.fds_processing_jobs_claim(text[], int, text, int, interval) from public, anon, authenticated;
revoke all on function public.fds_processing_job_heartbeat(uuid, numeric) from public, anon, authenticated;
revoke all on function public.fds_processing_job_complete(uuid, jsonb, text, int, int, bigint, numeric) from public, anon, authenticated;
revoke all on function public.fds_processing_job_fail(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fds_worker_verify_secret(text) to service_role;
grant execute on function public.fds_processing_jobs_claim(text[], int, text, int, interval) to service_role;
grant execute on function public.fds_processing_job_heartbeat(uuid, numeric) to service_role;
grant execute on function public.fds_processing_job_complete(uuid, jsonb, text, int, int, bigint, numeric) to service_role;
grant execute on function public.fds_processing_job_fail(uuid, text, boolean) to service_role;

-- ── pg_cron：有待處理任務才叫 worker ──────────────────────────────────

do $$
begin
  perform cron.unschedule('fds-process-jobs')
  from cron.job where jobname = 'fds-process-jobs';
end $$;

select cron.schedule(
  'fds-process-jobs',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://riaubhtruisbwdlwjzur.supabase.co/functions/v1/supabase-functions-process-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
    ),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 5000
  )
  where exists (
    select 1 from public.processing_jobs
    where attempts < max_attempts
      and ((status = 'queued' and run_after <= now())
        or (status = 'running' and heartbeat_at < now() - interval '10 minutes'))
  );
  $job$
);

notify pgrst, 'reload schema';
