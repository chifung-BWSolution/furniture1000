-- Authorize completion before the edge reads private Storage. Existing callers keep the default finalization mode.
drop function if exists public.fds_skp_device_complete(text, uuid, text, bigint, text);

create or replace function public.fds_skp_device_complete(
  p_access_token text,
  p_lease_id uuid,
  p_content_hash text,
  p_size_bytes bigint,
  p_storage_path text,
  p_verify_only boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_model public.furniture_models%rowtype;
  v_file text;
  v_register_hash text;
  v_done boolean;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id for update;
  if v_lease.id is null or v_lease.device_id is distinct from (v_gate ->> 'device_id')::uuid then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id for update;
  -- Bind even idempotent retries to the upload authorized for this lease.
  if p_storage_path is null or p_storage_path is distinct from v_lease.upload_path
     or p_content_hash is null or p_content_hash is distinct from v_lease.upload_file_hash
     or p_size_bytes is null or p_size_bytes is distinct from v_lease.upload_size then
    return jsonb_build_object('error', 'upload_rejected');
  end if;
  if v_job.status = 'succeeded'
     and (
       v_lease.content_hash = p_content_hash
       or v_job.result ->> 'storage_path' = p_storage_path
       or v_job.result ->> 'preview_storage_path' = p_storage_path
     ) then
    if p_verify_only then
      return jsonb_build_object('ok', true, 'idempotent', true);
    end if;
    update public.fds_skp_job_leases
    set status = 'completed', content_hash = coalesce(v_lease.content_hash, p_content_hash)
    where id = v_lease.id and status <> 'completed';
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if v_lease.status <> 'active' or v_job.attempts <> v_lease.attempt or v_job.worker is distinct from v_lease.device_id::text or v_job.status <> 'running' then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  if p_storage_path is distinct from v_lease.upload_path
     or p_content_hash is distinct from v_lease.upload_file_hash
     or p_size_bytes is distinct from v_lease.upload_size
     or v_lease.upload_expires_at is null
     or v_lease.upload_expires_at < now() then
    return jsonb_build_object('error', 'upload_rejected');
  end if;

  if p_verify_only then
    return jsonb_build_object('ok', true, 'verified', true);
  end if;

  if v_job.job_type = 'generate_skp' then
    select * into v_model from public.furniture_models where id = (v_job.payload ->> 'furniture_model_id')::uuid;
    if v_model.id is null then
      return jsonb_build_object('error', 'model_not_found');
    end if;
    v_file := left(regexp_replace(coalesce(v_model.kind, 'model'), '[^A-Za-z0-9_-]', '', 'g'), 40);
    if v_file = '' then v_file := 'model'; end if;
    v_file := v_file || '-' || coalesce(v_model.parametric ->> 'width_mm', '0') || 'x'
      || coalesce(v_model.parametric ->> 'depth_mm', '0') || 'x'
      || coalesce(v_model.parametric ->> 'height_mm', '0') || '.skp';
    v_done := public.fds_skp_job_finish(v_job.id, p_storage_path, p_size_bytes, p_content_hash, v_file);
  elsif v_job.job_type = 'preview_skp' then
    v_register_hash := coalesce(nullif(v_job.payload ->> 'content_hash', ''), p_content_hash);
    v_done := public.fds_skp_preview_job_finish(v_job.id, p_storage_path, p_size_bytes, v_register_hash);
  else
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not coalesce(v_done, false) then
    return jsonb_build_object('error', 'not_completed');
  end if;
  update public.fds_skp_job_leases
  set status = 'completed', content_hash = p_content_hash
  where id = v_lease.id;
  update public.fds_skp_devices
  set current_job_id = null, current_lease_id = null, updated_at = now()
  where id = v_lease.device_id;
  perform public.fds_skp_audit('job_complete', 'succeeded', v_lease.device_id, null, v_job.id,
    jsonb_build_object('lease_id', v_lease.id, 'bytes', p_size_bytes));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.fds_skp_device_complete(text, uuid, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.fds_skp_device_complete(text, uuid, text, bigint, text, boolean) to service_role;
notify pgrst, 'reload schema';
