-- 生成 3D 同時產出 FBX。格式仍是 3d；SKP 繼續只屬於 SU。

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.product_models'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%format%'
  loop
    execute format('alter table public.product_models drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.product_models
  add constraint product_models_format_check check (format in ('skp', 'glb', 'fbx')),
  add constraint product_models_su_is_skp check ((format = 'skp') = (model_type = 'su'));

create unique index if not exists product_models_one_generated_fbx
  on public.product_models (furniture_model_id)
  where source = 'generated' and format = 'fbx';

drop policy if exists "product_models_objects_insert_generated" on storage.objects;
create policy "product_models_objects_insert_generated"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-models'
    and name ~ '^generated/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.(glb|fbx)$'
    and public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer'])
  );

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
  if v_format is null or v_format not in ('skp', 'glb', 'fbx') then
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

create or replace function public.fds_product_model_register_generated(
  p_furniture_model_id uuid,
  p_storage_path text,
  p_file_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
  v_path text := btrim(coalesce(p_storage_path, ''));
  v_ext text;
  v_size bigint;
  v_id uuid;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);

  select * into v_model from public.furniture_models f
  where f.id = p_furniture_model_id
    and (f.created_by = auth.uid() or public.bwf_has_role(array['admin', 'uploader']));
  if v_model.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;
  if v_model.product_id is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  v_ext := lower(substring(v_path from '\.([A-Za-z0-9]+)$'));
  if v_ext is null or v_ext not in ('glb', 'fbx') then
    raise exception 'format_invalid' using errcode = '22023';
  end if;
  if v_path !~ ('^generated/' || lower(v_model.id::text) || '/[0-9a-f]{64}\.' || v_ext || '$') then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'product-models' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  if v_ext = 'glb' then
    insert into public.product_models (
      product_id, furniture_model_id, model_type, format, source,
      storage_path, file_name, size_bytes, created_by
    ) values (
      v_model.product_id, v_model.id, '3d', 'glb', 'generated',
      v_path, nullif(btrim(coalesce(p_file_name, '')), ''), v_size, auth.uid()
    )
    on conflict (furniture_model_id) where source = 'generated' and format = 'glb'
    do update set storage_path = excluded.storage_path, file_name = excluded.file_name, size_bytes = excluded.size_bytes
    returning id into v_id;
  else
    insert into public.product_models (
      product_id, furniture_model_id, model_type, format, source,
      storage_path, file_name, size_bytes, created_by
    ) values (
      v_model.product_id, v_model.id, '3d', 'fbx', 'generated',
      v_path, nullif(btrim(coalesce(p_file_name, '')), ''), v_size, auth.uid()
    )
    on conflict (furniture_model_id) where source = 'generated' and format = 'fbx'
    do update set storage_path = excluded.storage_path, file_name = excluded.file_name, size_bytes = excluded.size_bytes
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id, 'format', v_ext);
end;
$$;

revoke all on function public.fds_product_model_register(text, text, text) from public, anon;
grant execute on function public.fds_product_model_register(text, text, text) to authenticated;
revoke all on function public.fds_product_model_register_generated(uuid, text, text) from public, anon;
grant execute on function public.fds_product_model_register_generated(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
