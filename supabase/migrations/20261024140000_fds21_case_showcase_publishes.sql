-- 成功案例 › 發布到客戶專區（PRD：docs/prd/成功案例-PRD.md F-CASE-005）
--   只存內部同事「精選並修改後」的對外內容（payload jsonb）：
--   案例名稱、對外說明、完工相片 URL、客戶 Logo URL、PM 名稱（可選）等。
--   不複製 PMS 原始訂單／客戶資料；脫敏規則見 PRD §3.3
--   （無工廠、安裝團隊、內部備註、成本欄位）。
--   寫入限內部角色（沿用 bwf_has_role 慣例）；讀取公開——內容本身即對外材料。

create table if not exists public.case_showcase_publishes (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  published_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists case_showcase_publishes_updated_idx
  on public.case_showcase_publishes (updated_at desc);

alter table public.case_showcase_publishes enable row level security;
revoke all on table public.case_showcase_publishes from public, anon, authenticated;
grant select on table public.case_showcase_publishes to anon, authenticated;
grant insert, update, delete on table public.case_showcase_publishes to authenticated;

drop policy if exists "case_showcase_publishes_select" on public.case_showcase_publishes;
create policy "case_showcase_publishes_select"
  on public.case_showcase_publishes
  for select
  to anon, authenticated
  using (true);

drop policy if exists "case_showcase_publishes_insert" on public.case_showcase_publishes;
create policy "case_showcase_publishes_insert"
  on public.case_showcase_publishes
  for insert
  to authenticated
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']));

drop policy if exists "case_showcase_publishes_update" on public.case_showcase_publishes;
create policy "case_showcase_publishes_update"
  on public.case_showcase_publishes
  for update
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']));

drop policy if exists "case_showcase_publishes_delete" on public.case_showcase_publishes;
create policy "case_showcase_publishes_delete"
  on public.case_showcase_publishes
  for delete
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

create or replace function public.case_showcase_publishes_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.case_showcase_publishes_touch() from public, anon, authenticated;

drop trigger if exists case_showcase_publishes_touch on public.case_showcase_publishes;
create trigger case_showcase_publishes_touch
  before update on public.case_showcase_publishes
  for each row
  execute function public.case_showcase_publishes_touch();
