-- Day 8（T-801 / T-804）：參數化家具。GLB 由瀏覽器依這份 JSON 重算，不把檔案寫進資料庫。

create table if not exists public.furniture_models (
  id uuid primary key default gen_random_uuid(),
  product_id text references public.products(id) on delete set null,
  kind text not null check (kind in ('desk', 'conference', 'shelf', 'cabinet')),
  parametric jsonb not null,
  estimated boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.furniture_models enable row level security;
revoke all on public.furniture_models from public, anon, authenticated;
grant all on public.furniture_models to service_role;

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
  if p_kind not in ('desk', 'conference', 'shelf', 'cabinet') then
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
      'created_at', m.created_at
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

revoke all on function public.fds_list_furniture_models() from public, anon;
grant execute on function public.fds_list_furniture_models() to authenticated;

notify pgrst, 'reload schema';
