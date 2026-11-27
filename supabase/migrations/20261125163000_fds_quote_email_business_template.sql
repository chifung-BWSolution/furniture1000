-- FDS-15: Business-letter quotation email template fields and updated default PM closing.
-- Preserves existing 4-arg / 6-arg callers via trailing default-null parameters.

alter table public.bwf_quote_email_template
  add column if not exists subject_text text not null default '',
  add column if not exists product_title text not null default '',
  add column if not exists product_highlights text not null default '';

alter table public.bwf_quote_email_template
  drop constraint if exists bwf_quote_email_template_subject_len;
alter table public.bwf_quote_email_template
  add constraint bwf_quote_email_template_subject_len
  check (char_length(subject_text) <= 300);

alter table public.bwf_quote_email_template
  drop constraint if exists bwf_quote_email_template_product_title_len;
alter table public.bwf_quote_email_template
  add constraint bwf_quote_email_template_product_title_len
  check (char_length(product_title) <= 120);

alter table public.bwf_quote_email_template
  drop constraint if exists bwf_quote_email_template_product_highlights_len;
alter table public.bwf_quote_email_template
  add constraint bwf_quote_email_template_product_highlights_len
  check (char_length(product_highlights) <= 4000);

drop function if exists public.fds_quote_email_template_save(uuid, text, text, jsonb, text, text);

create or replace function public.fds_quote_email_template_save(
  p_quote_uuid uuid,
  p_intro text,
  p_contact_phone text,
  p_custom_sections jsonb default '[]'::jsonb,
  p_greeting text default null,
  p_locale text default null,
  p_subject text default null,
  p_product_title text default null,
  p_product_highlights text default null
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
    quote_uuid,
    intro_text,
    contact_phone,
    custom_sections,
    greeting_text,
    locale,
    subject_text,
    product_title,
    product_highlights,
    updated_by
  )
  values (
    p_quote_uuid,
    left(btrim(coalesce(p_intro, '')), 2000),
    left(btrim(coalesce(p_contact_phone, '')), 40),
    v_sections,
    left(btrim(coalesce(p_greeting, '')), 200),
    case when p_locale in ('zh-Hans', 'en') then p_locale else 'zh-Hant' end,
    left(btrim(coalesce(p_subject, '')), 300),
    left(btrim(coalesce(p_product_title, '')), 120),
    left(btrim(coalesce(p_product_highlights, '')), 4000),
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
        subject_text = case
          when p_subject is null then public.bwf_quote_email_template.subject_text
          else excluded.subject_text
        end,
        product_title = case
          when p_product_title is null then public.bwf_quote_email_template.product_title
          else excluded.product_title
        end,
        product_highlights = case
          when p_product_highlights is null then public.bwf_quote_email_template.product_highlights
          else excluded.product_highlights
        end,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.fds_quote_email_template_save(uuid, text, text, jsonb, text, text, text, text, text) from public, anon;
grant execute on function public.fds_quote_email_template_save(uuid, text, text, jsonb, text, text, text, text, text) to authenticated;

-- Upgrade unmodified previous default email closings across PM footers:
-- add YouTube channel and remove Online Store (www.bwfurnitures.com).
do $$
declare
  v_old text := E'BW Office Furniture (since 2009)\n\nOur Latest Furniture Category PDF\nhttps://bwoffice.asia/pages/catalog\n\nOnline Store:\nwww.bwfurnitures.com\n\nBrand Furniture:\nwww.bwoffice.asia';
  v_new text := E'BW Office Furniture (since 2009)\nYouTube 頻道\nhttps://www.youtube.com/@bwoffice-furniture\nOur Latest Furniture Category PDF\nhttps://bwoffice.asia/pages/catalog\nBrand Furniture:\nwww.bwoffice.asia';
begin
  update public.bwf_quote_email_footer
     set body_zh_hant = case
           when btrim(replace(body_zh_hant, E'\r\n', E'\n')) = v_old then v_new
           else body_zh_hant
         end,
         body_zh_hans = case
           when btrim(replace(body_zh_hans, E'\r\n', E'\n')) = v_old then v_new
           else body_zh_hans
         end,
         body_en = case
           when btrim(replace(body_en, E'\r\n', E'\n')) = v_old then v_new
           else body_en
         end
   where btrim(replace(body_zh_hant, E'\r\n', E'\n')) = v_old
      or btrim(replace(body_zh_hans, E'\r\n', E'\n')) = v_old
      or btrim(replace(body_en, E'\r\n', E'\n')) = v_old;
end;
$$;

notify pgrst, 'reload schema';
