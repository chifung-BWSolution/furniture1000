-- Colleague display name and phone sit beside the closing text.
-- Quote matching still uses pm_name.

alter table public.bwf_quote_email_footer
  add column if not exists sender_name text not null default '';

alter table public.bwf_quote_email_footer
  add column if not exists phone text not null default '';

update public.bwf_quote_email_footer
   set sender_name = pm_name
 where btrim(sender_name) = '';

alter table public.bwf_quote_email_footer
  drop constraint if exists bwf_quote_email_footer_sender_name_len;
alter table public.bwf_quote_email_footer
  add constraint bwf_quote_email_footer_sender_name_len
  check (char_length(sender_name) <= 120);

alter table public.bwf_quote_email_footer
  drop constraint if exists bwf_quote_email_footer_phone_len;
alter table public.bwf_quote_email_footer
  add constraint bwf_quote_email_footer_phone_len
  check (char_length(phone) <= 80);

grant update (sender_name, phone) on public.bwf_quote_email_footer to authenticated;

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
    'pm_name', f.pm_name,
    'sender_name', coalesce(nullif(btrim(f.sender_name), ''), f.pm_name),
    'phone', coalesce(f.phone, ''),
    'zh-Hant', f.body_zh_hant,
    'zh-Hans', f.body_zh_hans,
    'en', f.body_en
  )) -> 0 end
  into v_footer
  from public.bwf_quote q
  join public.bwf_quote_email_footer f
    on lower(btrim(f.pm_name)) = lower(btrim(q.project_data->'formData'->>'projectManager'))
  where q.id = p_quote_uuid;

  return v_footer;
end;
$$;

-- One team BCC address for every quotation email. Empty means do not BCC.
create table if not exists public.bwf_quote_email_delivery (
  id boolean primary key default true check (id),
  bcc_email text not null default 'sale@bwteam-furniture.com',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint bwf_quote_email_delivery_bcc_email_check check (
    char_length(bcc_email) <= 320
    and (
      bcc_email = ''
      or bcc_email ~ '^[^@<>"[:space:]]+@[^@<>"[:space:]]+\.[^@<>"[:space:]]+$'
    )
  )
);

insert into public.bwf_quote_email_delivery (id)
values (true)
on conflict (id) do nothing;

alter table public.bwf_quote_email_delivery enable row level security;
revoke all on table public.bwf_quote_email_delivery from public, anon, authenticated;
grant select, update on table public.bwf_quote_email_delivery to authenticated;

drop policy if exists bwf_quote_email_delivery_read on public.bwf_quote_email_delivery;
create policy bwf_quote_email_delivery_read on public.bwf_quote_email_delivery
  for select to authenticated
  using (public.bwf_has_role(array['admin', 'pm', 'uploader']));

drop policy if exists bwf_quote_email_delivery_edit on public.bwf_quote_email_delivery;
create policy bwf_quote_email_delivery_edit on public.bwf_quote_email_delivery
  for update to authenticated
  using (public.bwf_has_role(array['admin', 'pm', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'pm', 'uploader']));

create or replace function public.bwf_quote_email_delivery_touch()
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

revoke all on function public.bwf_quote_email_delivery_touch() from public, anon, authenticated;

drop trigger if exists bwf_quote_email_delivery_touch on public.bwf_quote_email_delivery;
create trigger bwf_quote_email_delivery_touch
  before update on public.bwf_quote_email_delivery
  for each row
  execute function public.bwf_quote_email_delivery_touch();

notify pgrst, 'reload schema';
