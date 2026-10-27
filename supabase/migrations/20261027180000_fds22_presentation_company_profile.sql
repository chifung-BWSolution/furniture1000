-- FDS 2.2：簡報「公司介紹」只有一列，給每份五段簡報重用。
-- 客戶端不可新增或刪除這一列。

create table if not exists public.fds_presentation_company_profile (
  id boolean primary key default true check (id),
  background text not null default '',
  strengths text not null default '',
  services text not null default '',
  qualifications text not null default '',
  capabilities text not null default '',
  updated_at timestamptz not null default now(),
  constraint fds_presentation_company_profile_background_len check (char_length(background) <= 2000),
  constraint fds_presentation_company_profile_strengths_len check (char_length(strengths) <= 2000),
  constraint fds_presentation_company_profile_services_len check (char_length(services) <= 2000),
  constraint fds_presentation_company_profile_qualifications_len check (char_length(qualifications) <= 2000),
  constraint fds_presentation_company_profile_capabilities_len check (char_length(capabilities) <= 2000)
);

insert into public.fds_presentation_company_profile (id)
values (true)
on conflict (id) do nothing;

alter table public.fds_presentation_company_profile enable row level security;
revoke all on table public.fds_presentation_company_profile from public, anon, authenticated;
grant select, update on table public.fds_presentation_company_profile to authenticated;

drop policy if exists "fds_presentation_company_profile_select" on public.fds_presentation_company_profile;
create policy "fds_presentation_company_profile_select"
  on public.fds_presentation_company_profile
  for select
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff']));

drop policy if exists "fds_presentation_company_profile_update" on public.fds_presentation_company_profile;
create policy "fds_presentation_company_profile_update"
  on public.fds_presentation_company_profile
  for update
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));

notify pgrst, 'reload schema';
