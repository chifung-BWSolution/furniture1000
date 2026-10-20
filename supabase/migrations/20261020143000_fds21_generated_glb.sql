-- 產品詳情直接生成的 GLB：設計師把瀏覽器建好的檔放進 product-models/generated/<model id>/<sha256>.glb，
-- 再經 RPC 綁到該參數模型的產品。SKP 仍由 Windows worker 寫入。

create unique index if not exists product_models_one_generated_glb
  on public.product_models (furniture_model_id)
  where source = 'generated' and format = 'glb';

drop policy if exists "product_models_objects_insert_generated" on storage.objects;
create policy "product_models_objects_insert_generated"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'product-models'
    and name ~ '^generated/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{64}\.glb$'
    and public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer'])
  );

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
  if v_path !~ ('^generated/' || lower(v_model.id::text) || '/[0-9a-f]{64}\.glb$') then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'product-models' and o.name = v_path;
  if not found then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;

  insert into public.product_models (
    product_id, furniture_model_id, model_type, format, source,
    storage_path, file_name, size_bytes, created_by
  ) values (
    v_model.product_id, v_model.id, '3d', 'glb', 'generated',
    v_path, nullif(btrim(coalesce(p_file_name, '')), ''), v_size, auth.uid()
  )
  on conflict (furniture_model_id) where source = 'generated' and format = 'glb'
  do update set
    storage_path = excluded.storage_path,
    file_name = excluded.file_name,
    size_bytes = excluded.size_bytes
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'format', 'glb');
end;
$$;

revoke all on function public.fds_product_model_register_generated(uuid, text, text) from public, anon;
grant execute on function public.fds_product_model_register_generated(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
