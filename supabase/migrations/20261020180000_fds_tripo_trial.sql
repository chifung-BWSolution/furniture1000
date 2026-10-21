-- Tripo trial: reuse processing_jobs and product_models; no parallel task/model tables.
create policy product_models_tripo_reference_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'product-models'
    and public.bwf_has_role(array['admin', 'uploader'])
    and name ~ ('^tripo-inputs/' || auth.uid()::text || '/[0-9a-f-]{36}\.jpg$')
  );
create unique index if not exists processing_jobs_one_active_tripo_product
  on public.processing_jobs ((payload ->> 'product_id'))
  where job_type = 'generate_tripo' and status in ('queued', 'running');

create or replace function public.fds_request_tripo_model(
  p_product_id text, p_reference_path text, p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_expected text := 'tripo-inputs/' || auth.uid()::text || '/' || p_request_id::text || '.jpg';
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product_not_found';
  end if;
  if p_reference_path is distinct from v_expected then raise exception 'reference_path_invalid'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'product-models'
    and name = p_reference_path and (metadata ->> 'size')::bigint between 1 and 20971520) then
    raise exception 'reference_image_missing';
  end if;
  -- A stable browser request ID makes retrying a lost response safe.
  select id into v_id from public.processing_jobs
    where idempotency_key = 'tripo:' || p_request_id::text;
  if v_id is not null then return v_id; end if;
  begin
    insert into public.processing_jobs(job_type, payload, idempotency_key, creator_staff_id)
    values ('generate_tripo', jsonb_build_object('product_id', p_product_id,
      'reference_path', p_reference_path, 'user_id', auth.uid()),
      'tripo:' || p_request_id::text, public.bwf_current_staff_id())
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.processing_jobs where
      idempotency_key = 'tripo:' || p_request_id::text or
      (job_type = 'generate_tripo' and payload ->> 'product_id' = p_product_id
        and status in ('queued', 'running'))
      order by created_at desc limit 1;
    if v_id is null then raise; end if;
  end;
  return v_id;
end;
$$;
revoke all on function public.fds_request_tripo_model(text, text, uuid) from public, anon;
grant execute on function public.fds_request_tripo_model(text, text, uuid) to authenticated;

-- Registration and completion are one transaction, including the cancellation check.
create or replace function public.fds_tripo_model_complete(
  p_job_id uuid, p_storage_path text, p_credits numeric
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_job public.processing_jobs%rowtype;
  v_size bigint;
  v_model_id uuid;
begin
  select * into v_job from public.processing_jobs where id = p_job_id
    and job_type = 'generate_tripo' and status = 'running' for update;
  if v_job.id is null then return false; end if;
  if p_storage_path <> 'generated/tripo/' || p_job_id::text || '/model.glb' then
    raise exception 'storage_path_invalid';
  end if;
  select (metadata ->> 'size')::bigint into v_size from storage.objects
    where bucket_id = 'product-models' and name = p_storage_path;
  if v_size is null or v_size < 12 then raise exception 'storage_object_missing'; end if;
  insert into public.product_models(product_id, model_type, format, source,
    storage_path, file_name, size_bytes, created_by)
  values (v_job.payload ->> 'product_id', '3d', 'glb', 'generated', p_storage_path,
    'Tripo-' || (v_job.payload ->> 'product_id') || '.glb', v_size,
    (v_job.payload ->> 'user_id')::uuid)
  on conflict (storage_path) do update set size_bytes = excluded.size_bytes
  returning id into v_model_id;
  return public.fds_processing_job_complete(p_job_id,
    jsonb_build_object('provider', 'tripo', 'model_id', v_model_id,
      'storage_path', p_storage_path, 'credits_consumed', p_credits),
    p_cost_actual => greatest(coalesce(p_credits, 0), 0) * 0.01);
end;
$$;
revoke all on function public.fds_tripo_model_complete(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.fds_tripo_model_complete(uuid, text, numeric) to service_role;

notify pgrst, 'reload schema';
