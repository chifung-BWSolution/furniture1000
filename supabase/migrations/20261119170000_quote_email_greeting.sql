-- The opening line of a quotation email is edited with the template.
-- Null from older saves leaves a stored greeting unchanged.

alter table public.bwf_quote_email_template
  add column if not exists greeting_text text not null default '';

alter table public.bwf_quote_email_template
  drop constraint if exists bwf_quote_email_template_greeting_len;
alter table public.bwf_quote_email_template
  add constraint bwf_quote_email_template_greeting_len
  check (char_length(greeting_text) <= 200);

alter table public.bwf_quote_email_template
  add column if not exists locale text not null default 'zh-Hant';

alter table public.bwf_quote_email_template
  drop constraint if exists bwf_quote_email_template_locale_check;
alter table public.bwf_quote_email_template
  add constraint bwf_quote_email_template_locale_check
  check (locale in ('zh-Hant', 'zh-Hans', 'en'));

drop function if exists public.fds_quote_email_template_save(uuid, text, text, jsonb);
drop function if exists public.fds_quote_email_template_save(uuid, text, text, jsonb, text);

create or replace function public.fds_quote_email_template_save(
  p_quote_uuid uuid,
  p_intro text,
  p_contact_phone text,
  p_custom_sections jsonb default '[]'::jsonb,
  p_greeting text default null,
  p_locale text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sections jsonb := coalesce(p_custom_sections, '[]'::jsonb);
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(v_sections) <> 'array' or jsonb_array_length(v_sections) > 10 then
    raise exception 'invalid_sections' using errcode = '22023';
  end if;

  insert into public.bwf_quote_email_template (
    quote_uuid, intro_text, contact_phone, custom_sections, greeting_text, locale, updated_by
  )
  values (
    p_quote_uuid,
    left(btrim(coalesce(p_intro, '')), 2000),
    left(btrim(coalesce(p_contact_phone, '')), 40),
    v_sections,
    left(btrim(coalesce(p_greeting, '')), 200),
    case when p_locale in ('zh-Hans', 'en') then p_locale else 'zh-Hant' end,
    auth.uid()
  )
  on conflict (quote_uuid) do update
    set intro_text = excluded.intro_text,
        contact_phone = excluded.contact_phone,
        custom_sections = excluded.custom_sections,
        greeting_text = case
          when p_greeting is null then public.bwf_quote_email_template.greeting_text
          else excluded.greeting_text
        end,
        locale = case
          when p_locale is null then public.bwf_quote_email_template.locale
          else excluded.locale
        end,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.fds_quote_email_template_save(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.fds_quote_email_template_save(uuid, text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';
