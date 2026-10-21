-- Review fixes for T-805/T-807 (applied after 20261021160000; do not edit that file).
-- 1. Retrying a preview must requeue a finished job. The old idempotency insert
--    did nothing, while the caller had already marked the preview pending.
-- 2. A worker timeout that fails the job must not leave preview_status pending.
-- 3. When a generate job replaces the SKP while a preview is still running,
--    finish schedules another preview for the new file.
-- 4. Register paths are an exact prefix, not a LIKE pattern (product ids may contain _).
-- 5. Preview status is limited to the same roles as the model list.

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
  v_rows int := 0;
begin
  select * into v_row from public.product_models where id = p_product_model_id for update;
  if v_row.id is null or v_row.format <> 'skp' then
    return;
  end if;

  v_hash := coalesce(
    v_row.content_hash,
    substring(v_row.storage_path from '/([0-9a-f]{64})\.skp$')
  );
  if v_hash is null then
    v_hash := encode(extensions.digest(v_row.storage_path, 'sha256'), 'hex');
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
  on conflict (idempotency_key) do update
    set status = 'queued',
        payload = excluded.payload,
        error = null,
        attempts = 0,
        progress = 0,
        result = null,
        run_after = now(),
        started_at = null,
        finished_at = null,
        heartbeat_at = null,
        worker = null,
        updated_at = now(),
        error_log = public.processing_jobs.error_log || jsonb_build_array(jsonb_build_object(
          'at', now(),
          'error', 'requeued',
          'previous_status', public.processing_jobs.status
        ))
    where public.processing_jobs.status in ('failed', 'succeeded', 'cancelled');
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
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
end;
$$;

create or replace function public.fds_skp_preview_status_for(p_product_model_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  end if;

  return coalesce(
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
        'status', 'failed',
        'job_id', j.id,
        'attempts', j.attempts,
        'error', coalesce(j.error, 'preview_failed'),
        'updated_at', j.finished_at
      )
      from public.processing_jobs j
      where j.job_type = 'preview_skp'
        and j.payload ->> 'product_model_id' = p_product_model_id::text
        and j.status in ('failed', 'cancelled')
      order by j.created_at desc
      limit 1
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
end;
$$;

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
  v_prefix text;
  v_rest text;
  v_done boolean;
begin
  select * into v_job from public.processing_jobs
  where id = p_job_id and job_type = 'preview_skp' and status = 'running'
  for update;
  if v_job.id is null then
    return false;
  end if;

  v_model_id := (v_job.payload ->> 'product_model_id')::uuid;
  v_prefix := 'preview/' || v_model_id::text || '/';
  v_rest := substring(p_storage_path from length(v_prefix) + 1);
  if v_model_id is null
     or left(p_storage_path, length(v_prefix)) is distinct from v_prefix
     or right(p_storage_path, 4) <> '.glb'
     or v_rest is null
     or v_rest = ''
     or position('/' in v_rest) > 0
     or position('..' in p_storage_path) > 0
     or position(E'\\' in p_storage_path) > 0 then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  v_done := public.fds_processing_job_complete(
    p_job_id,
    jsonb_build_object('preview_storage_path', p_storage_path, 'size_bytes', p_size_bytes)
  );
  if not v_done then
    return false;
  end if;

  update public.product_models
  set preview_status = 'ready',
      preview_storage_path = p_storage_path,
      preview_content_hash = p_content_hash,
      preview_error = null,
      preview_updated_at = now()
  where id = v_model_id;

  -- The SKP row may have moved on while this conversion ran.
  begin
    perform public.fds_enqueue_skp_preview(v_model_id);
  exception
    when unique_violation then
      null;
  end;

  return true;
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
  v_prefix text := 'uploaded/' || coalesce(p_product_id, '') || '/';
  v_rest text;
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
  v_rest := substring(v_path from length(v_prefix) + 1);
  if p_product_id is null
     or btrim(p_product_id) = ''
     or position('/' in p_product_id) > 0
     or position('%' in p_product_id) > 0
     or position(E'\\' in p_product_id) > 0
     or left(v_path, length(v_prefix)) is distinct from v_prefix
     or v_rest is null
     or v_rest = ''
     or position('/' in v_rest) > 0
     or position('..' in v_path) > 0
     or position(E'\\' in v_path) > 0 then
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

  v_hash := substring(v_path from '/([0-9a-f]{64})\.');

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

revoke all on function public.fds_enqueue_skp_preview(uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_preview_status_for(uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_preview_job_finish(uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.fds_product_model_register(text, text, text, text) from public, anon;

grant execute on function public.fds_enqueue_skp_preview(uuid) to service_role;
grant execute on function public.fds_skp_preview_status_for(uuid) to authenticated, service_role;
grant execute on function public.fds_skp_preview_job_finish(uuid, text, bigint, text) to service_role;
grant execute on function public.fds_product_model_register(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
