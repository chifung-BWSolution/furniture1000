-- 報價單格式設定（公司只有一列）。
-- QR 文案、修訂日期、分區小計的呈現。客戶端只可讀寫這一列，不可新增或刪除。

create table if not exists public.quote_format_settings (
  id boolean primary key default true check (id),
  qr_caption text not null default '線上選擇／修改產品',
  show_revision_date boolean not null default true,
  show_latest_modified_date boolean not null default true,
  zone_subtotal_placement text not null default 'section_and_summary'
    check (zone_subtotal_placement in ('section_and_summary', 'summary_only', 'hidden')),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.quote_format_settings (id)
values (true)
on conflict (id) do nothing;

alter table public.quote_format_settings enable row level security;
revoke all on table public.quote_format_settings from public, anon, authenticated;
grant select, update on table public.quote_format_settings to authenticated;

drop policy if exists "quote_format_settings_select" on public.quote_format_settings;
create policy "quote_format_settings_select"
  on public.quote_format_settings
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff'])
  );

drop policy if exists "quote_format_settings_update" on public.quote_format_settings;
create policy "quote_format_settings_update"
  on public.quote_format_settings
  for update
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'uploader']));

create or replace function public.quote_format_settings_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.quote_format_settings_touch() from public, anon, authenticated;

drop trigger if exists quote_format_settings_touch on public.quote_format_settings;
create trigger quote_format_settings_touch
  before update on public.quote_format_settings
  for each row
  execute function public.quote_format_settings_touch();
