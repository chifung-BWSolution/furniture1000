-- One localized in-card email footer per PMS staff identity.
create table public.bwf_quote_email_footer (
  pms_staff_id uuid primary key,
  pm_name text not null check (btrim(pm_name) <> ''),
  body_zh_hant text not null check (char_length(body_zh_hant) <= 2000),
  body_zh_hans text not null check (char_length(body_zh_hans) <= 2000),
  body_en text not null check (char_length(body_en) <= 2000)
);

create index bwf_quote_email_footer_pm_name_idx
  on public.bwf_quote_email_footer (lower(btrim(pm_name)));

alter table public.bwf_quote_email_footer enable row level security;
revoke all on table public.bwf_quote_email_footer from public, anon, authenticated;
grant select on table public.bwf_quote_email_footer to authenticated;
grant update (body_zh_hant, body_zh_hans, body_en) on public.bwf_quote_email_footer to authenticated;
grant select, insert on table public.bwf_quote_email_footer to service_role;

create policy bwf_quote_email_footer_read on public.bwf_quote_email_footer
  for select to authenticated using (public.bwf_has_role(array['admin', 'pm', 'uploader']));

create policy bwf_quote_email_footer_edit on public.bwf_quote_email_footer
  for update to authenticated using (
    public.bwf_has_role(array['admin'])
    or (public.bwf_has_role(array['pm']) and pms_staff_id = public.bwf_current_staff_id())
  );

-- Existing quotations store the assigned PM's name. Only use an unambiguous match.
create or replace function public.fds_quote_email_footer(p_quote_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_footer jsonb;
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'pm', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select case when count(*) = 1 then jsonb_agg(jsonb_build_object(
    'zh-Hant', f.body_zh_hant, 'zh-Hans', f.body_zh_hans, 'en', f.body_en
  )) -> 0 end
  into v_footer
  from public.bwf_quote q
  join public.bwf_quote_email_footer f
    on lower(btrim(f.pm_name)) = lower(btrim(q.project_data->'formData'->>'projectManager'))
  where q.id = p_quote_uuid;

  return v_footer;
end;
$$;

revoke all on function public.fds_quote_email_footer(uuid) from public, anon;
grant execute on function public.fds_quote_email_footer(uuid) to authenticated, service_role;
