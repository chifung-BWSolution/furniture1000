-- Own-domain short share URLs (/q/<code>) for quotation share links.

create or replace function public.bwf_gen_share_short_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- A short code grants the same access as the full share token.
  select translate(encode(uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_');
$$;

alter table public.bwf_quote_share_links
  add column if not exists short_code text;

do $$
declare
  rec record;
  v_code text;
begin
  for rec in
    select id
      from public.bwf_quote_share_links
     where short_code is null or btrim(short_code) = ''
     order by created_at asc
  loop
    loop
      v_code := public.bwf_gen_share_short_code();
      exit when not exists (
        select 1 from public.bwf_quote_share_links l where l.short_code = v_code
      );
    end loop;
    update public.bwf_quote_share_links
       set short_code = v_code
     where id = rec.id;
  end loop;
end;
$$;

alter table public.bwf_quote_share_links
  alter column short_code set default public.bwf_gen_share_short_code(),
  alter column short_code set not null;

create unique index if not exists idx_bwf_quote_share_links_short_code
  on public.bwf_quote_share_links (short_code);

create or replace function public.resolve_quote_share_short_code(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select l.share_token
    from public.bwf_quote_share_links l
   where l.short_code = btrim(coalesce(p_code, ''))
     and l.status = 'active'
     and (l.expires_at is null or l.expires_at > now())
   order by l.created_at desc
   limit 1;
$$;

revoke all on function public.resolve_quote_share_short_code(text) from public;
grant execute on function public.resolve_quote_share_short_code(text) to anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fds_quote_email_claim(p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rows jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  with due as (
    select m.id
      from public.bwf_quote_email_message m
     where m.status = 'queued'
       and m.scheduled_for <= now()
       and m.attempts < 3
     order by m.scheduled_for asc
     limit greatest(1, least(coalesce(p_limit, 10), 50))
       for update skip locked
  ), claimed as (
    update public.bwf_quote_email_message m
       set status = 'sending',
           attempts = m.attempts + 1,
           updated_at = now()
      from due
     where m.id = due.id
    returning m.*
  )
  select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.scheduled_for), '[]'::jsonb)
    into v_rows
    from (
      select
        c.id,
        c.quote_uuid,
        c.kind,
        c.to_email,
        c.attempts,
        coalesce(q.quote_id, '') as quote_id,
        coalesce(t.intro_text, '') as intro_text,
        coalesce(t.contact_phone, '') as contact_phone,
        coalesce(t.locale, 'zh-Hant') as locale,
        left(coalesce(
          s.recipient_name,
          nullif(btrim(q.project_data->'clientInfo'->>'contactName'), ''),
          nullif(btrim(q.project_data->'formData'->>'clientContactName'), ''),
          nullif(btrim(q.project_data->'clientInfo'->>'name'), ''),
          nullif(btrim(q.project_data->'formData'->>'clientName'), '')
        ), 200) as recipient_name,
        coalesce(t.custom_sections, '[]'::jsonb) as custom_sections,
        coalesce(s.status, 'not_sent') as settings_status,
        c.scheduled_for,
        (
          select l.share_token
            from public.bwf_quote_share_links l
           where l.quote_uuid = c.quote_uuid
             and l.status = 'active'
             and (l.expires_at is null or l.expires_at > now())
           order by l.created_at desc
           limit 1
        ) as share_token,
        (
          select l.short_code
            from public.bwf_quote_share_links l
           where l.quote_uuid = c.quote_uuid
             and l.status = 'active'
             and (l.expires_at is null or l.expires_at > now())
           order by l.created_at desc
           limit 1
        ) as share_short_code,
        (
          select count(*)::int
            from public.bwf_quote_item it
           where it.quote_uuid = c.quote_uuid
             and coalesce(it.is_section_title, false) = false
             and coalesce(it.is_custom_term, false) = false
        ) as item_count,
        coalesce(q.total_amount, 0) as total_amount,
        (
          select string_agg(sub.name, '、')
            from (
              select it.name
                from public.bwf_quote_item it
               where it.quote_uuid = c.quote_uuid
                 and coalesce(it.is_section_title, false) = false
                 and coalesce(it.is_custom_term, false) = false
                 and btrim(coalesce(it.name, '')) <> ''
               order by it.sort_order
               limit 5
            ) sub
        ) as sample_items
        from claimed c
        join public.bwf_quote q on q.id = c.quote_uuid
        left join public.bwf_quote_email_template t on t.quote_uuid = c.quote_uuid
        left join public.bwf_quote_email_settings s on s.quote_uuid = c.quote_uuid
    ) row_data;

  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fds_quote_email_status(p_quote_uuid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body jsonb;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'quote_uuid', p_quote_uuid,
    'intro_text', coalesce(t.intro_text, ''),
    'contact_phone', coalesce(t.contact_phone, ''),
    'custom_sections', coalesce(t.custom_sections, '[]'::jsonb),
    'status', coalesce(s.status, 'not_sent'),
    'recipient_email', s.recipient_email,
    'recipient_name', s.recipient_name,
    'locale', coalesce(t.locale, 'zh-Hant'),
    'auto_follow_up', coalesce(s.auto_follow_up, true),
    'last_sent_at', s.last_sent_at,
    'next_follow_up_at', s.next_follow_up_at,
    'first_viewed_at', s.first_viewed_at,
    'stopped_at', s.stopped_at,
    'stop_reason', s.stop_reason,
    'share_token', (
      select l.share_token
        from public.bwf_quote_share_links l
       where l.quote_uuid = p_quote_uuid
         and l.status = 'active'
         and (l.expires_at is null or l.expires_at > now())
       order by l.created_at desc
       limit 1
    ),
    'share_short_code', (
      select l.short_code
        from public.bwf_quote_share_links l
       where l.quote_uuid = p_quote_uuid
         and l.status = 'active'
         and (l.expires_at is null or l.expires_at > now())
       order by l.created_at desc
       limit 1
    ),
    'item_count', (
      select count(*)::int
        from public.bwf_quote_item it
       where it.quote_uuid = p_quote_uuid
         and coalesce(it.is_section_title, false) = false
         and coalesce(it.is_custom_term, false) = false
    ),
    'total_amount', coalesce((select q.total_amount from public.bwf_quote q where q.id = p_quote_uuid), 0),
    'sample_items', (
      select string_agg(sub.name, '、')
        from (
          select it.name
            from public.bwf_quote_item it
           where it.quote_uuid = p_quote_uuid
             and coalesce(it.is_section_title, false) = false
             and coalesce(it.is_custom_term, false) = false
             and btrim(coalesce(it.name, '')) <> ''
           order by it.sort_order
           limit 5
        ) sub
    ),
    'messages', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.created_at desc)
        from (
          select id, kind, to_email, status, attempts, sent_at, error, created_at
            from public.bwf_quote_email_message
           where quote_uuid = p_quote_uuid
           order by created_at desc
           limit 20
        ) m
    ), '[]'::jsonb),
    'views', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.viewed_at desc)
        from (
          select viewed_at, is_valid, reason, user_agent
            from public.bwf_quote_share_view
           where quote_uuid = p_quote_uuid
           order by viewed_at desc
           limit 20
        ) v
    ), '[]'::jsonb)
  )
    into v_body
    from (select p_quote_uuid as quote_uuid) base
    left join public.bwf_quote_email_template t on t.quote_uuid = base.quote_uuid
    left join public.bwf_quote_email_settings s on s.quote_uuid = base.quote_uuid;

  return v_body;
end;
$function$;

notify pgrst, 'reload schema';
