-- D-5 / D-6 / F-AI-008：產品模型檔（SKP 給 SU、GLB 給 3D）。
--   上載：admin / uploader 把 skp / glb 放進私有 bucket product-models，經 RPC 綁定產品。
--   生成：參數化家具排一個 generate_skp 任務，Windows 上的 SketchUp SDK worker 寫出 SKP 後回填。
-- 下載只用短效簽名 URL；表本身不開 select，一律經 RPC。

create table if not exists public.product_models (
  id uuid primary key default gen_random_uuid(),
  product_id text references public.products(id) on delete cascade,
  furniture_model_id uuid references public.furniture_models(id) on delete cascade,
  model_type text not null check (model_type in ('su', '3d')),
  format text not null check (format in ('skp', 'glb')),
  source text not null check (source in ('uploaded', 'generated')),
  storage_path text not null unique,
  file_name text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  content_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (product_id is not null or furniture_model_id is not null),
  check ((format = 'skp') = (model_type = 'su'))
);

create index if not exists product_models_product_idx
  on public.product_models (product_id, created_at desc) where product_id is not null;
create unique index if not exists product_models_one_generated_skp
  on public.product_models (furniture_model_id)
  where source = 'generated' and format = 'skp';

alter table public.product_models enable row level security;
revoke all on public.product_models from public, anon, authenticated;
grant all on public.product_models to service_role;

-- One live SKP job per parametric model.
create unique index if not exists processing_jobs_one_active_skp
  on public.processing_jobs ((payload ->> 'furniture_model_id'))
  where job_type = 'generate_skp' and status in ('queued', 'running');

-- ── Storage：私有 bucket product-models ──────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-models', 'product-models', false, 104857600, null)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product_models_objects_insert" on storage.objects;
create policy "product_models_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-models'
    and name like 'uploaded/%'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

drop policy if exists "product_models_objects_delete" on storage.objects;
create policy "product_models_objects_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'product-models'
    and name like 'uploaded/%'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

-- Signing a download URL needs select on the object.
drop policy if exists "product_models_objects_select" on storage.objects;
create policy "product_models_objects_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'product-models'
    and public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer'])
  );

-- ── 讀取 ──────────────────────────────────────────────────────────────

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
      'created_at', m.created_at
    ) order by m.model_type, m.created_at desc)
    from public.product_models m
    where m.product_id = p_product_id
  ), '[]'::jsonb);
end;
$$;

-- {"<product id>": {"su": true, "3d": false}} for the cards on screen.
create or replace function public.fds_product_model_flags(p_product_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  return coalesce((
    select jsonb_object_agg(f.product_id, jsonb_build_object('su', f.su, '3d', f.three_d))
    from (
      select m.product_id,
             bool_or(m.model_type = 'su') as su,
             bool_or(m.model_type = '3d') as three_d
      from public.product_models m
      where m.product_id = any ((coalesce(p_product_ids, array[]::text[]))[1:200])
      group by m.product_id
    ) f
  ), '{}'::jsonb);
end;
$$;

-- ── 上載綁定 ──────────────────────────────────────────────────────────

create or replace function public.fds_product_model_register(
  p_product_id text,
  p_storage_path text,
  p_file_name text default null
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
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if v_path not like 'uploaded/' || p_product_id || '/%' then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;
  v_format := lower(substring(v_path from '\.([A-Za-z0-9]+)$'));
  if v_format is null or v_format not in ('skp', 'glb') then
    raise exception 'format_invalid' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'product-models' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, created_by
  ) values (
    p_product_id,
    case when v_format = 'skp' then 'su' else '3d' end,
    v_format,
    'uploaded',
    v_path,
    nullif(btrim(coalesce(p_file_name, '')), ''),
    v_size,
    auth.uid()
  )
  on conflict (storage_path) do update
    set file_name = coalesce(excluded.file_name, public.product_models.file_name),
        size_bytes = excluded.size_bytes
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'format', v_format);
end;
$$;

-- Returns the storage path so the caller can remove the object it uploaded.
create or replace function public.fds_product_model_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_models%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  delete from public.product_models where id = p_id and source = 'uploaded'
  returning * into v_row;
  if v_row.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', v_row.id, 'storage_path', v_row.storage_path);
end;
$$;

-- ── 生成 SKP ──────────────────────────────────────────────────────────

create or replace function public.fds_skp_status_for(p_furniture_model_id uuid)
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
        'storage_path', m.storage_path,
        'size_bytes', m.size_bytes,
        'file_name', m.file_name
      )
      from public.product_models m
      where m.furniture_model_id = p_furniture_model_id
        and m.source = 'generated' and m.format = 'skp'
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
      where j.job_type = 'generate_skp'
        and j.payload ->> 'furniture_model_id' = p_furniture_model_id::text
      order by j.created_at desc
      limit 1
    ),
    jsonb_build_object('status', 'none')
  );
$$;

revoke all on function public.fds_skp_status_for(uuid) from public, anon, authenticated;

create or replace function public.fds_skp_status(p_furniture_model_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  if not exists (
    select 1 from public.furniture_models f
    where f.id = p_furniture_model_id
      and (f.created_by = auth.uid() or public.bwf_has_role(array['admin', 'uploader']))
  ) then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;
  return public.fds_skp_status_for(p_furniture_model_id);
end;
$$;

create or replace function public.fds_request_skp(p_furniture_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
  v_status jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_model from public.furniture_models f
  where f.id = p_furniture_model_id
    and (f.created_by = auth.uid() or public.bwf_has_role(array['admin', 'uploader']))
  for update;
  if v_model.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;

  v_status := public.fds_skp_status_for(p_furniture_model_id);
  if v_status ->> 'status' in ('ready', 'queued', 'running') then
    return v_status;
  end if;

  insert into public.processing_jobs (job_type, payload, creator_staff_id)
  values (
    'generate_skp',
    jsonb_build_object('furniture_model_id', p_furniture_model_id, 'kind', v_model.kind),
    public.bwf_current_staff_id()
  );

  return public.fds_skp_status_for(p_furniture_model_id);
end;
$$;

-- Windows worker: the SKP is already in storage; record it and close the job.
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
                content_hash = excluded.content_hash;

  return public.fds_processing_job_complete(
    p_job_id,
    jsonb_build_object('storage_path', p_storage_path, 'size_bytes', p_size_bytes)
  );
end;
$$;

-- Recent parametric models now carry their SKP state.
create or replace function public.fds_list_furniture_models()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_admin := public.bwf_has_role(array['admin', 'uploader']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'kind', m.kind,
      'estimated', m.estimated,
      'width_mm', m.parametric -> 'width_mm',
      'depth_mm', m.parametric -> 'depth_mm',
      'height_mm', m.parametric -> 'height_mm',
      'created_at', m.created_at,
      'skp', public.fds_skp_status_for(m.id)
    ) order by m.created_at desc)
    from (
      select *
      from public.furniture_models
      where v_admin or created_by = auth.uid()
      order by created_at desc
      limit 12
    ) m
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_product_models(text) from public, anon;
revoke all on function public.fds_product_model_flags(text[]) from public, anon;
revoke all on function public.fds_product_model_register(text, text, text) from public, anon;
revoke all on function public.fds_product_model_delete(uuid) from public, anon;
revoke all on function public.fds_skp_status(uuid) from public, anon;
revoke all on function public.fds_request_skp(uuid) from public, anon;
revoke all on function public.fds_skp_job_finish(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.fds_product_models(text) to authenticated;
grant execute on function public.fds_product_model_flags(text[]) to authenticated;
grant execute on function public.fds_product_model_register(text, text, text) to authenticated;
grant execute on function public.fds_product_model_delete(uuid) to authenticated;
grant execute on function public.fds_skp_status(uuid) to authenticated;
grant execute on function public.fds_request_skp(uuid) to authenticated;
grant execute on function public.fds_skp_job_finish(uuid, text, bigint, text, text) to service_role;

notify pgrst, 'reload schema';
