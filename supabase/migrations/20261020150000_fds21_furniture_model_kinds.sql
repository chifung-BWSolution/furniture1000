-- Day 8（T-801 / T-804）：參數化模板按 FDS 產品類別擴充，取消只做四類的限制。
-- 清單要與 src/lib/furnitureParametric.ts 的 FurnitureKind 一致。

alter table public.furniture_models drop constraint if exists furniture_models_kind_check;
alter table public.furniture_models add constraint furniture_models_kind_check check (kind in (
  'desk', 'conference', 'dining', 'coffee', 'bar_counter', 'reception', 'lectern',
  'cabinet', 'pedestal', 'shelf',
  'office_chair', 'side_chair', 'stool', 'beam_seating', 'sofa', 'booth',
  'phone_booth'
));

create or replace function public.fds_save_furniture_model(
  p_kind text,
  p_parametric jsonb,
  p_estimated boolean default false,
  p_product_id text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_kind not in (
    'desk', 'conference', 'dining', 'coffee', 'bar_counter', 'reception', 'lectern',
    'cabinet', 'pedestal', 'shelf',
    'office_chair', 'side_chair', 'stool', 'beam_seating', 'sofa', 'booth',
    'phone_booth'
  ) then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_parametric) <> 'object' then
    raise exception 'parametric_invalid' using errcode = '22023';
  end if;
  insert into public.furniture_models (product_id, kind, parametric, estimated, created_by)
  values (nullif(p_product_id, ''), p_kind, p_parametric, coalesce(p_estimated, false), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fds_save_furniture_model(text, jsonb, boolean, text) from public, anon;
grant execute on function public.fds_save_furniture_model(text, jsonb, boolean, text) to authenticated;

notify pgrst, 'reload schema';
