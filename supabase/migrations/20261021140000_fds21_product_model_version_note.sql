-- T-805: optional version note on uploaded product models.

alter table public.product_models
  add column if not exists version_note text;

comment on column public.product_models.version_note is
  'Uploader-provided label for this file version (SKP/GLB/FBX).';

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
      'created_at', m.created_at
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
    product_id, model_type, format, source, storage_path, file_name, size_bytes, version_note, created_by
  ) values (
    p_product_id,
    case when v_format = 'skp' then 'su' else '3d' end,
    v_format,
    'uploaded',
    v_path,
    nullif(btrim(coalesce(p_file_name, '')), ''),
    v_size,
    v_note,
    auth.uid()
  )
  on conflict (storage_path) do update
    set file_name = coalesce(excluded.file_name, public.product_models.file_name),
        size_bytes = excluded.size_bytes,
        version_note = coalesce(excluded.version_note, public.product_models.version_note)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'format', v_format);
end;
$$;
