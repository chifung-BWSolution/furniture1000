-- T-807: uploaded / generated SKP → GLB preview via Windows preview_skp jobs.

create extension if not exists pgcrypto;

alter table public.product_models
  add column if not exists preview_status text not null default 'none'
    check (preview_status in ('none', 'pending', 'ready', 'failed')),
  add column if not exists preview_storage_path text,
  add column if not exists preview_error text,
  add column if not exists preview_content_hash text,
  add column if not exists preview_updated_at timestamptz;

comment on column public.product_models.preview_status is
  'Browser GLB derivative of SKP rows: none/pending/ready/failed (separate from SKP validity).';

create unique index if not exists processing_jobs_one_active_preview_skp
  on public.processing_jobs ((payload ->> 'product_model_id'))
  where job_type = 'preview_skp' and status in ('queued', 'running');

-- ── enqueue / status ─────────────────────────────────────────────────

create or replace function public.fds_enqueue_skp_preview(p_product_model_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_models%rowtype;
  v_hash text;
  v_active uuid;
begin
  select * into v_row from public.product_models where id = p_product_model_id for update;
  if v_row.id is null or v_row.format <> 'skp' then
    return;
  end if;

  v_hash := coalesce(
    v_row.content_hash,
    substring(v_row.storage_path from '/([0-9a-f]{64})\\.skp$')
  );
  if v_hash is null then
    v_hash := encode(digest(v_row.storage_path, 'sha256'), 'hex');
  end if;

  if v_row.preview_status = 'ready'
     and v_row.preview_content_hash = v_hash
     and v_row.preview_storage_path is not null then
    return;
  end if;

  select j.id into v_active
  from public.processing_jobs j
  where j.job_type = 'preview_skp'
    and j.payload ->> 'product_model_id' = p_product_model_id::text
    and j.status in ('queued', 'running')
  limit 1;
  if v_active is not null then
    update public.product_models
    set preview_status = 'pending', preview_error = null, preview_updated_at = now()
    where id = p_product_model_id;
    return;
  end if;

  update public.product_models
  set preview_status = 'pending',
      preview_error = null,
      preview_storage_path = null,
      preview_updated_at = now()
  where id = p_product_model_id;

  insert into public.processing_jobs (job_type, payload, idempotency_key, creator_staff_id)
  values (
    'preview_skp',
    jsonb_build_object(
      'product_model_id', p_product_model_id,
      'storage_path', v_row.storage_path,
      'content_hash', v_hash
    ),
    'preview_skp:' || p_product_model_id::text || ':' || v_hash,
    public.bwf_current_staff_id()
  )
  on conflict (idempotency_key) do nothing;
end;
$$;

create or replace function public.fds_skp_preview_status_for(p_product_model_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'status', 'ready',
        'storage_path', m.preview_storage_path,
        'updated_at', m.preview_updated_at
      )
      from public.product_models m
      where m.id = p_product_model_id
        and m.format = 'skp'
        and m.preview_status = 'ready'
        and m.preview_storage_path is not null
    ),
    (
      select jsonb_build_object(
        'status', j.status,
        'job_id', j.id,
        'attempts', j.attempts,
        'error', j.error,
        'created_at', j.created_at
      )
      from public.processing_jobs j
      where j.job_type = 'preview_skp'
        and j.payload ->> 'product_model_id' = p_product_model_id::text
        and j.status in ('queued', 'running')
      order by j.created_at desc
      limit 1
    ),
    (
      select jsonb_build_object(
        'status', 'failed',
        'error', coalesce(m.preview_error, 'preview_failed'),
        'updated_at', m.preview_updated_at
      )
      from public.product_models m
      where m.id = p_product_model_id
        and m.format = 'skp'
        and m.preview_status = 'failed'
    ),
    (
      select jsonb_build_object(
        'status', case when m.preview_status = 'pending' then 'pending' else 'none' end,
        'updated_at', m.preview_updated_at
      )
      from public.product_models m
      where m.id = p_product_model_id and m.format = 'skp'
    ),
    jsonb_build_object('status', 'none')
  );
$$;

create or replace function public.fds_request_skp_preview(p_product_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_models%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_row from public.product_models m
  where m.id = p_product_model_id
    and m.format = 'skp'
    and exists (
      select 1 from public.products p
      where p.id = m.product_id
    );
  if v_row.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;

  update public.product_models
  set preview_status = 'none', preview_error = null
  where id = p_product_model_id;

  perform public.fds_enqueue_skp_preview(p_product_model_id);
  return public.fds_skp_preview_status_for(p_product_model_id);
end;
$$;

-- ── worker finish / fail ─────────────────────────────────────────────

create or replace function public.fds_skp_preview_job_finish(
  p_job_id uuid,
  p_storage_path text,
  p_size_bytes bigint,
  p_content_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_model_id uuid;
begin
  select * into v_job from public.processing_jobs
  where id = p_job_id and job_type = 'preview_skp' and status = 'running'
  for update;
  if v_job.id is null then
    return false;
  end if;

  v_model_id := (v_job.payload ->> 'product_model_id')::uuid;
  if p_storage_path not like 'preview/' || v_model_id::text || '/%.glb' then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  update public.product_models
  set preview_status = 'ready',
      preview_storage_path = p_storage_path,
      preview_content_hash = p_content_hash,
      preview_error = null,
      preview_updated_at = now()
  where id = v_model_id;

  return public.fds_processing_job_complete(
    p_job_id,
    jsonb_build_object('preview_storage_path', p_storage_path, 'size_bytes', p_size_bytes)
  );
end;
$$;

create or replace function public.fds_skp_preview_job_fail(
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
  v_out text;
  v_model_id uuid;
begin
  v_out := public.fds_processing_job_fail(p_job_id, p_error, p_retryable);
  select * into v_job from public.processing_jobs where id = p_job_id;
  if v_job.id is null then
    return v_out;
  end if;
  v_model_id := (v_job.payload ->> 'product_model_id')::uuid;
  if v_out = 'failed' and v_model_id is not null then
    update public.product_models
    set preview_status = 'failed',
        preview_error = left(coalesce(nullif(btrim(p_error), ''), 'preview_failed'), 2000),
        preview_updated_at = now()
    where id = v_model_id;
  end if;
  return v_out;
end;
$$;

-- ── list / register hooks ────────────────────────────────────────────

create or replace function public.fds_product_models(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'model_type', m.model_type,
      'format', m.format,
      'source', m.source,
      'storage_path', m.storage_path,
      'file_name', m.file_name,
      'size_bytes', m.size_bytes,
      'version_note', m.version_note,
      'created_at', m.created_at,
      'preview', case when m.format = 'skp' then public.fds_skp_preview_status_for(m.id) else null end
    ) order by m.model_type, m.created_at desc)
    from public.product_models m
    where m.product_id = p_product_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fds_product_model_register(
  p_product_id text,
  p_storage_path text,
  p_file_name text default null,
  p_version_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_format text;
  v_size bigint;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_version_note, '')), '');
  v_hash text;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if v_path not like 'uploaded/' || p_product_id || '/%' then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;
  v_format := lower(substring(v_path from '\.([A-Za-z0-9]+)$'));
  if v_format is null or v_format not in ('skp', 'glb', 'fbx') then
    raise exception 'format_invalid' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'product-models' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  v_hash := substring(v_path from '/([0-9a-f]{64})\\.');

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash, version_note, created_by
  ) values (
    p_product_id,
    case when v_format = 'skp' then 'su' else '3d' end,
    v_format,
    'uploaded',
    v_path,
    nullif(btrim(coalesce(p_file_name, '')), ''),
    v_size,
    v_hash,
    v_note,
    auth.uid()
  )
  on conflict (storage_path) do update
    set file_name = coalesce(excluded.file_name, public.product_models.file_name),
        size_bytes = excluded.size_bytes,
        version_note = coalesce(excluded.version_note, public.product_models.version_note),
        content_hash = coalesce(excluded.content_hash, public.product_models.content_hash)
  returning id into v_id;

  if v_format = 'skp' then
    perform public.fds_enqueue_skp_preview(v_id);
  end if;

  return jsonb_build_object('id', v_id, 'format', v_format);
end;
$$;

create or replace function public.fds_skp_job_finish(
  p_job_id uuid,
  p_storage_path text,
  p_size_bytes bigint,
  p_content_hash text,
  p_file_name text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_model public.furniture_models%rowtype;
  v_pm_id uuid;
begin
  select * into v_job from public.processing_jobs
  where id = p_job_id and job_type = 'generate_skp' and status = 'running'
  for update;
  if v_job.id is null then
    return false;
  end if;
  select * into v_model from public.furniture_models
  where id = (v_job.payload ->> 'furniture_model_id')::uuid;
  if v_model.id is null then
    perform public.fds_processing_job_fail(p_job_id, 'model_not_found', false);
    return false;
  end if;
  if p_storage_path not like 'generated/' || v_model.id::text || '/%.skp' then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  insert into public.product_models (
    product_id, furniture_model_id, model_type, format, source,
    storage_path, file_name, size_bytes, content_hash, created_by
  ) values (
    v_model.product_id, v_model.id, 'su', 'skp', 'generated',
    p_storage_path, p_file_name, p_size_bytes, p_content_hash, v_model.created_by
  )
  on conflict (furniture_model_id) where source = 'generated' and format = 'skp'
  do update set storage_path = excluded.storage_path,
                file_name = excluded.file_name,
                size_bytes = excluded.size_bytes,
                content_hash = excluded.content_hash
  returning id into v_pm_id;

  perform public.fds_enqueue_skp_preview(v_pm_id);

  return public.fds_processing_job_complete(
    p_job_id,
    jsonb_build_object('storage_path', p_storage_path, 'size_bytes', p_size_bytes)
  );
end;
$$;

revoke all on function public.fds_product_models(text) from public, anon;
revoke execute on function public.fds_product_model_register(text, text, text, text) from public, anon;
grant execute on function public.fds_product_models(text) to authenticated;
grant execute on function public.fds_product_model_register(text, text, text, text) to authenticated;

revoke all on function public.fds_enqueue_skp_preview(uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_preview_status_for(uuid) from public, anon, authenticated;
revoke all on function public.fds_request_skp_preview(uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_preview_job_finish(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.fds_skp_preview_job_fail(uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.fds_enqueue_skp_preview(uuid) to service_role;
grant execute on function public.fds_skp_preview_status_for(uuid) to authenticated, service_role;
grant execute on function public.fds_request_skp_preview(uuid) to authenticated;
grant execute on function public.fds_skp_preview_job_finish(uuid, text, bigint, text) to service_role;
grant execute on function public.fds_skp_preview_job_fail(uuid, text, boolean) to service_role;

-- Backfill preview jobs for existing SKP rows (non-blocking; worker converts when available).
do $$
declare
  v_id uuid;
begin
  for v_id in
    select m.id
    from public.product_models m
    where m.format = 'skp'
      and m.preview_status in ('none', 'failed')
  loop
    perform public.fds_enqueue_skp_preview(v_id);
  end loop;
end;
$$;
