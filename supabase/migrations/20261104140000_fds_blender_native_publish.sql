-- Blender publishes validated FBX/GLB independently; existing Codex/SketchUp contracts retain required SKP.
-- Missing SKP never retires an existing SKP model. Device authentication and lease checks are preserved.
create or replace function public.fds_skp_device_publish(
  p_access_token text,
  p_lease_id uuid,
  p_manifest_hash text,
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
  v_required text[] := array['skp', 'fbx', 'fbx_bundle', 'glb', 'preview', 'validation', 'manifest'];
  v_role text;
  v_art public.fds_skp_generation_artifacts%rowtype;
  v_arts jsonb := '{}'::jsonb;
  v_user uuid;
  v_base text;
  v_note text := 'AI 草稿（本機 Codex 依產品資料及圖片建模，未經人工驗收）';
  v_skp_id uuid;
  v_fbx_id uuid;
  v_glb_id uuid;
  v_replaced int := 0;
  v_done boolean;
  v_blender boolean := false;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  if p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id for update;
  if v_lease.id is null or v_lease.device_id is distinct from (v_gate ->> 'device_id')::uuid then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id for update;
  if v_job.job_type <> 'generate_skp' or v_job.payload ->> 'mode' is distinct from 'codex_v1' then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- Only an authenticated Blender-capable device may publish without SKP.
  select coalesce(d.checks -> 'capabilities', '[]'::jsonb) ? 'blender_v1'
  into v_blender from public.fds_skp_devices d where d.id = v_lease.device_id;
  if coalesce(v_blender, false) then v_required := array_remove(v_required, 'skp'); end if;

  -- Lost response: the same manifest was already published by this lease.
  if v_job.status = 'succeeded' then
    if v_job.result ->> 'manifest_hash' = p_manifest_hash and v_job.result ->> 'lease_id' = v_lease.id::text then
      update public.fds_skp_job_leases set status = 'completed', content_hash = p_manifest_hash
      where id = v_lease.id and status <> 'completed';
      return jsonb_build_object('ok', true, 'idempotent', true, 'models', v_job.result -> 'models');
    end if;
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  if v_lease.status <> 'active' or v_job.attempts <> v_lease.attempt
     or v_job.worker is distinct from v_lease.device_id::text or v_job.status <> 'running' then
    return jsonb_build_object('error', 'lease_rejected');
  end if;

  foreach v_role in array v_required || array['report'] || case when v_blender then array['skp'] else array[]::text[] end
  loop
    select * into v_art from public.fds_skp_generation_artifacts a
    where a.job_id = v_job.id and a.attempt = v_lease.attempt and a.lease_id = v_lease.id and a.role = v_role;
    if v_art.id is null then
      if v_role = any (v_required) then
        return jsonb_build_object('error', 'artifact_missing', 'role', v_role);
      end if;
      continue;
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'product-models' and o.name = v_art.storage_path
        and (o.metadata ->> 'size')::bigint = v_art.size_bytes
    ) then
      return jsonb_build_object('error', 'artifact_missing', 'role', v_role);
    end if;
    v_arts := v_arts || jsonb_build_object(v_role, jsonb_build_object(
      'path', v_art.storage_path, 'size_bytes', v_art.size_bytes, 'sha256', v_art.content_hash));
  end loop;
  if v_arts #>> '{manifest,sha256}' is distinct from p_manifest_hash then
    return jsonb_build_object('error', 'upload_rejected');
  end if;
  if p_verify_only then
    return jsonb_build_object('ok', true, 'verified', true);
  end if;

  v_user := nullif(v_job.payload ->> 'user_id', '')::uuid;
  v_base := left(regexp_replace(coalesce(
      nullif(v_job.payload #>> '{snapshot,product,model}', ''),
      nullif(v_job.payload #>> '{snapshot,product,sku}', ''),
      v_job.payload ->> 'product_id'), '[^A-Za-z0-9_.-]+', '_', 'g'), 80)
    || '-ai-' || to_char(now(), 'YYYYMMDD-HH24MI');

  if v_arts ? 'skp' then
  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode,
    preview_status, preview_storage_path, preview_content_hash, preview_updated_at
  ) values (
    v_job.payload ->> 'product_id', 'su', 'skp', 'generated', v_arts #>> '{skp,path}', v_base || '.skp',
    (v_arts #>> '{skp,size_bytes}')::bigint, v_arts #>> '{skp,sha256}',
    v_user, v_note, v_job.id, 'codex_v1',
    'ready', v_arts #>> '{glb,path}', v_arts #>> '{glb,sha256}', now()
  ) returning id into v_skp_id;
  end if;

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode, bundle_storage_path
  ) values (
    v_job.payload ->> 'product_id', '3d', 'fbx', 'generated', v_arts #>> '{fbx,path}', v_base || '.fbx',
    (v_arts #>> '{fbx,size_bytes}')::bigint, v_arts #>> '{fbx,sha256}',
    v_user, v_note, v_job.id, 'codex_v1', v_arts #>> '{fbx_bundle,path}'
  ) returning id into v_fbx_id;

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode
  ) values (
    v_job.payload ->> 'product_id', '3d', 'glb', 'generated', v_arts #>> '{glb,path}', v_base || '.glb',
    (v_arts #>> '{glb,size_bytes}')::bigint, v_arts #>> '{glb,sha256}',
    v_user, v_note, v_job.id, 'codex_v1'
  ) returning id into v_glb_id;

  -- Explicit replacement only, after the new set is registered in this same transaction.
  with gone as (
    delete from public.product_models m
    where m.product_id = v_job.payload ->> 'product_id'
      and m.id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_job.payload -> 'replace_model_ids', '[]'::jsonb)))
      and m.id <> all(array_remove(array[v_skp_id, v_fbx_id, v_glb_id], null))
      and (m.format <> 'skp' or v_skp_id is not null)
    returning m.*
  )
  insert into public.fds_product_models_retired (id, product_id, row_data, storage_paths, replaced_by_job_id)
  select g.id, g.product_id, to_jsonb(g),
         array_remove(array[g.storage_path, g.preview_storage_path, g.bundle_storage_path], null),
         v_job.id
  from gone g
  on conflict (id) do nothing;
  get diagnostics v_replaced = row_count;

  v_done := public.fds_processing_job_complete(v_job.id, jsonb_build_object(
    'mode', 'codex_v1',
    'engine', case when v_blender then 'blender' else 'codex' end,
    'skp_status', case when v_skp_id is null then 'unavailable' else 'ready' end,
    'stage', 'done',
    'stage_at', now(),
    'lease_id', v_lease.id,
    'manifest_hash', p_manifest_hash,
    'artifacts', v_arts,
    'replaced', v_replaced,
    'models', jsonb_strip_nulls(jsonb_build_object('skp', v_skp_id, 'fbx', v_fbx_id, 'glb', v_glb_id))
  ));
  if not coalesce(v_done, false) then
    raise exception 'not_completed';
  end if;
  update public.fds_skp_job_leases set status = 'completed', content_hash = p_manifest_hash where id = v_lease.id;
  update public.fds_skp_devices set current_job_id = null, current_lease_id = null, updated_at = now()
  where id = v_lease.device_id;
  perform public.fds_skp_audit('job_publish', 'succeeded', v_lease.device_id, null, v_job.id,
    jsonb_build_object('lease_id', v_lease.id, 'manifest_hash', p_manifest_hash, 'replaced', v_replaced));
  return jsonb_build_object('ok', true, 'models', jsonb_strip_nulls(jsonb_build_object('skp', v_skp_id, 'fbx', v_fbx_id, 'glb', v_glb_id)));
end;
$$;
