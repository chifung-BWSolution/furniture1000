-- FDS-15 郵件模板與跟進。
-- 每張正式報價各自保存模板（不設全站共用模板），固定三段：
--   1. 報價內容簡述（系統按報價現況生成，可加自訂引言）
--   2. 可電話聯繫（用該單範本記錄的負責同事電話，無資料時拒絕發送）
--   3. 該報價加單授權連結（只接受該單現有的有效分享連結）
-- 手動與自動發送都用「發送當下」的模板；自動跟進每 3 天一次，首次有效查看即停該單。

create table if not exists public.bwf_quote_email_template (
  quote_uuid uuid primary key references public.bwf_quote (id) on delete cascade,
  intro_text text not null default '',
  contact_phone text not null default '',
  custom_sections jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint bwf_quote_email_template_intro_len check (char_length(intro_text) <= 2000),
  constraint bwf_quote_email_template_phone_len check (char_length(contact_phone) <= 40),
  constraint bwf_quote_email_template_sections_array check (jsonb_typeof(custom_sections) = 'array')
);

create table if not exists public.bwf_quote_email_settings (
  quote_uuid uuid primary key references public.bwf_quote (id) on delete cascade,
  status text not null default 'not_sent'
    check (status in ('not_sent', 'sent', 'auto_follow_up_active', 'viewed', 'stopped')),
  recipient_email text,
  recipient_name text,
  auto_follow_up boolean not null default true,
  last_sent_at timestamptz,
  next_follow_up_at timestamptz,
  first_viewed_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.bwf_quote_email_message (
  id uuid primary key default gen_random_uuid(),
  quote_uuid uuid not null references public.bwf_quote (id) on delete cascade,
  kind text not null check (kind in ('manual', 'follow_up')),
  to_email text not null,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bwf_quote_email_message_quote_idx
  on public.bwf_quote_email_message (quote_uuid, created_at desc);
create index if not exists bwf_quote_email_message_due_idx
  on public.bwf_quote_email_message (scheduled_for)
  where status = 'queued';

-- 同一報價同類郵件最多一筆待發，避免重複排程／重複發信。
create unique index if not exists bwf_quote_email_message_one_pending
  on public.bwf_quote_email_message (quote_uuid, kind)
  where status in ('queued', 'sending');

create table if not exists public.bwf_quote_share_view (
  id uuid primary key default gen_random_uuid(),
  quote_uuid uuid not null references public.bwf_quote (id) on delete cascade,
  quote_id text not null default '',
  viewed_at timestamptz not null default now(),
  is_valid boolean not null default false,
  reason text,
  user_agent text,
  ip_hash text,
  referer text,
  email_message_id uuid references public.bwf_quote_email_message (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bwf_quote_share_view_quote_idx
  on public.bwf_quote_share_view (quote_uuid, viewed_at desc);

alter table public.bwf_quote_email_template enable row level security;
alter table public.bwf_quote_email_settings enable row level security;
alter table public.bwf_quote_email_message enable row level security;
alter table public.bwf_quote_share_view enable row level security;

revoke all on table public.bwf_quote_email_template from public, anon, authenticated;
revoke all on table public.bwf_quote_email_settings from public, anon, authenticated;
revoke all on table public.bwf_quote_email_message from public, anon, authenticated;
revoke all on table public.bwf_quote_share_view from public, anon, authenticated;
grant select on table public.bwf_quote_email_template to authenticated;
grant select on table public.bwf_quote_email_settings to authenticated;
grant select on table public.bwf_quote_email_message to authenticated;
grant select on table public.bwf_quote_share_view to authenticated;

drop policy if exists "bwf_quote_email_template_select_staff" on public.bwf_quote_email_template;
create policy "bwf_quote_email_template_select_staff"
  on public.bwf_quote_email_template for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "bwf_quote_email_settings_select_staff" on public.bwf_quote_email_settings;
create policy "bwf_quote_email_settings_select_staff"
  on public.bwf_quote_email_settings for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "bwf_quote_email_message_select_staff" on public.bwf_quote_email_message;
create policy "bwf_quote_email_message_select_staff"
  on public.bwf_quote_email_message for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "bwf_quote_share_view_select_staff" on public.bwf_quote_share_view;
create policy "bwf_quote_share_view_select_staff"
  on public.bwf_quote_share_view for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

create or replace function public.fds_quote_email_template_save(
  p_quote_uuid uuid,
  p_intro text,
  p_contact_phone text,
  p_custom_sections jsonb default '[]'::jsonb
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

  insert into public.bwf_quote_email_template (quote_uuid, intro_text, contact_phone, custom_sections, updated_by)
  values (
    p_quote_uuid,
    left(btrim(coalesce(p_intro, '')), 2000),
    left(btrim(coalesce(p_contact_phone, '')), 40),
    v_sections,
    auth.uid()
  )
  on conflict (quote_uuid) do update
    set intro_text = excluded.intro_text,
        contact_phone = excluded.contact_phone,
        custom_sections = excluded.custom_sections,
        updated_by = excluded.updated_by,
        updated_at = now();
end;
$$;

revoke all on function public.fds_quote_email_template_save(uuid, text, text, jsonb) from public, anon;
grant execute on function public.fds_quote_email_template_save(uuid, text, text, jsonb) to authenticated;

create or replace function public.fds_quote_email_schedule(
  p_quote_uuid uuid,
  p_to text,
  p_kind text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to text := lower(btrim(coalesce(p_to, '')));
  v_phone text;
  v_token text;
  v_status text;
  v_id uuid;
  v_quote_id text;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_kind not in ('manual', 'follow_up') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if v_to = '' or v_to !~ '^[^@<>"\s]+@[^@<>"\s]+\.[^@<>"\s]+$' or char_length(v_to) > 320 then
    raise exception 'invalid_recipient' using errcode = '22023';
  end if;

  select q.quote_id into v_quote_id from public.bwf_quote q
   where q.id = p_quote_uuid and q.status is distinct from '回收桶';
  if v_quote_id is null then
    raise exception 'quote_not_found' using errcode = 'P0002';
  end if;

  select nullif(btrim(t.contact_phone), '') into v_phone
    from public.bwf_quote_email_template t
   where t.quote_uuid = p_quote_uuid;
  if v_phone is null then
    raise exception 'contact_phone_missing' using errcode = '22023';
  end if;

  select l.share_token into v_token
    from public.bwf_quote_share_links l
   where l.quote_uuid = p_quote_uuid
     and l.status = 'active'
     and (l.expires_at is null or l.expires_at > now())
   order by l.created_at desc
   limit 1;
  if v_token is null then
    raise exception 'share_link_missing' using errcode = '22023';
  end if;

  insert into public.bwf_quote_email_settings (quote_uuid, status, recipient_email)
  values (p_quote_uuid, 'not_sent', v_to)
  on conflict (quote_uuid) do update
    set recipient_email = excluded.recipient_email,
        updated_at = now();

  select s.status into v_status from public.bwf_quote_email_settings s where s.quote_uuid = p_quote_uuid;
  if v_status in ('viewed', 'stopped') and p_kind = 'follow_up' then
    raise exception 'auto_follow_up_stopped' using errcode = '22023';
  end if;

  insert into public.bwf_quote_email_message (quote_uuid, kind, to_email, status, scheduled_for, created_by)
  values (p_quote_uuid, p_kind, v_to, 'queued', now(), auth.uid())
  on conflict (quote_uuid, kind) where status in ('queued', 'sending') do nothing
  returning id into v_id;

  if v_id is null then
    select m.id into v_id
      from public.bwf_quote_email_message m
     where m.quote_uuid = p_quote_uuid
       and m.kind = p_kind
       and m.status in ('queued', 'sending')
     limit 1;
  end if;

  return v_id;
end;
$$;

revoke all on function public.fds_quote_email_schedule(uuid, text, text) from public, anon;
grant execute on function public.fds_quote_email_schedule(uuid, text, text) to authenticated;

create or replace function public.fds_quote_email_stop(
  p_quote_uuid uuid,
  p_reason text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  insert into public.bwf_quote_email_settings (quote_uuid, status, auto_follow_up, stopped_at, stop_reason)
  values (p_quote_uuid, 'stopped', false, now(), left(coalesce(p_reason, 'manual'), 120))
  on conflict (quote_uuid) do update
    set status = 'stopped',
        auto_follow_up = false,
        stopped_at = now(),
        stop_reason = left(coalesce(p_reason, 'manual'), 120),
        updated_at = now();
  update public.bwf_quote_email_message
     set status = 'cancelled', updated_at = now()
   where quote_uuid = p_quote_uuid and kind = 'follow_up' and status = 'queued';
end;
$$;

revoke all on function public.fds_quote_email_stop(uuid, text) from public, anon;
grant execute on function public.fds_quote_email_stop(uuid, text) to authenticated;

/** 每次只排一筆：超過下一次跟進時間、未查看、仍在自動跟進狀態。 */
create or replace function public.fds_quote_email_enqueue_follow_ups(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_row record;
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  for v_row in
    select s.quote_uuid, s.recipient_email
      from public.bwf_quote_email_settings s
     where s.auto_follow_up
       and s.status = 'auto_follow_up_active'
       and s.first_viewed_at is null
       and s.next_follow_up_at is not null
       and s.next_follow_up_at <= now()
       and s.recipient_email is not null
     order by s.next_follow_up_at asc
     limit greatest(1, least(coalesce(p_limit, 20), 100))
       for update skip locked
  loop
    begin
      insert into public.bwf_quote_email_message (quote_uuid, kind, to_email, status, scheduled_for)
      values (v_row.quote_uuid, 'follow_up', v_row.recipient_email, 'queued', now());
      update public.bwf_quote_email_settings
         set next_follow_up_at = now() + interval '3 days',
             updated_at = now()
       where quote_uuid = v_row.quote_uuid;
      v_count := v_count + 1;
    exception
      when unique_violation then
        -- 已有一筆待發跟進信，今次不重複排程。
        continue;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.fds_quote_email_enqueue_follow_ups(integer) from public, anon, authenticated;
grant execute on function public.fds_quote_email_enqueue_follow_ups(integer) to service_role;

/** Worker 領取待發郵件；同時回傳發送當下的模板與報價摘要。 */
create or replace function public.fds_quote_email_claim(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
        coalesce(t.custom_sections, '[]'::jsonb) as custom_sections,
        coalesce(s.status, 'not_sent') as settings_status,
        c.scheduled_for
        , (
          select l.share_token
            from public.bwf_quote_share_links l
           where l.quote_uuid = c.quote_uuid
             and l.status = 'active'
             and (l.expires_at is null or l.expires_at > now())
           order by l.created_at desc
           limit 1
        ) as share_token,
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
$$;

revoke all on function public.fds_quote_email_claim(integer) from public, anon, authenticated;
grant execute on function public.fds_quote_email_claim(integer) to service_role;

create or replace function public.fds_quote_email_mark(
  p_id uuid,
  p_status text,
  p_error text default null,
  p_provider text default null,
  p_message_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bwf_quote_email_message;
  v_settings_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_status not in ('sent', 'failed', 'queued') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update public.bwf_quote_email_message
     set status = p_status,
         error = nullif(left(coalesce(p_error, ''), 500), ''),
         provider = coalesce(p_provider, provider),
         provider_message_id = coalesce(p_message_id, provider_message_id),
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         scheduled_for = case when p_status = 'queued' then now() + interval '10 minutes' else scheduled_for end,
         updated_at = now()
   where id = p_id
  returning * into v_row;

  if v_row.id is null then
    return;
  end if;

  if p_status <> 'sent' then
    return;
  end if;

  select s.status into v_settings_status
    from public.bwf_quote_email_settings s
   where s.quote_uuid = v_row.quote_uuid;

  insert into public.bwf_quote_email_settings as s (
    quote_uuid, status, recipient_email, last_sent_at, auto_follow_up, next_follow_up_at
  )
  values (
    v_row.quote_uuid, 'auto_follow_up_active', v_row.to_email, now(), true, now() + interval '3 days'
  )
  on conflict (quote_uuid) do update
    set last_sent_at = now(),
        recipient_email = excluded.recipient_email,
        status = case
          when s.status in ('viewed', 'stopped') then s.status
          else 'auto_follow_up_active'
        end,
        auto_follow_up = case
          when s.status in ('viewed', 'stopped') then false
          else true
        end,
        next_follow_up_at = case
          when s.status in ('viewed', 'stopped') then s.next_follow_up_at
          when v_row.kind = 'manual' then now() + interval '3 days'
          else s.next_follow_up_at
        end,
        updated_at = now();
end;
$$;

revoke all on function public.fds_quote_email_mark(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fds_quote_email_mark(uuid, text, text, text, text) to service_role;

/** 報價一覽／報價詳情用的狀態卡。 */
create or replace function public.fds_quote_email_status(p_quote_uuid uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.fds_quote_email_status(uuid) from public, anon;
grant execute on function public.fds_quote_email_status(uuid) to authenticated;

/**
 * 記錄分享連結查看。只由前端在真的載入授權頁後呼叫（不是 GET，也不是圖片載入）。
 * 判定為有效查看時，只停該單的自動跟進信；其他報價不受影響。
 * 已知掃描器以 UA 比對排除；會執行 JS 的掃描器仍有誤判可能，這點寫在交付文件。
 */
create or replace function public.record_quote_share_view(
  p_token text,
  p_user_agent text default null,
  p_referer text default null,
  p_force_invalid boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote uuid;
  v_quote_id text;
  v_ua text := left(btrim(coalesce(p_user_agent, '')), 400);
  v_ref text := left(btrim(coalesce(p_referer, '')), 400);
  v_ip text;
  v_ip_hash text;
  v_reason text;
  v_valid boolean := true;
  v_message uuid;
  v_recent boolean;
begin
  v_quote := public.bwf_active_share_quote(p_token);
  if v_quote is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid_token', 'stopped', false);
  end if;

  select q.quote_id into v_quote_id from public.bwf_quote q where q.id = v_quote;

  begin
    v_ip := split_part(
      coalesce(
        (current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'),
        ''
      ),
      ',',
      1
    );
  exception
    when others then
      v_ip := '';
  end;
  v_ip_hash := case when btrim(coalesce(v_ip, '')) = '' then null else md5(btrim(v_ip)) end;

  if p_force_invalid then
    v_valid := false;
    v_reason := 'client_reported_bot';
  elsif v_ua = '' then
    v_valid := false;
    v_reason := 'no_user_agent';
  elsif v_ua ~* '(bot|crawl|spider|slurp|preview|scanner|scan|curl|wget|python|java/|headless|phantom|selenium|puppeteer|playwright|facebookexternalhit|whatsapp|slack|telegram|discord|linkedin|twitterbot|bingbot|googlebot|yandex|baidu|uptime|monitor|proofpoint|mimecast|barracuda)'
  then
    v_valid := false;
    v_reason := 'known_scanner';
  end if;

  -- 同一 token + UA + IP 在 30 分鐘內只記一次，避免重複事件。
  select exists (
    select 1
      from public.bwf_quote_share_view v
     where v.quote_uuid = v_quote
       and coalesce(v.user_agent, '') = v_ua
       and coalesce(v.ip_hash, '') = coalesce(v_ip_hash, '')
       and v.viewed_at > now() - interval '30 minutes'
  ) into v_recent;

  if v_recent then
    return jsonb_build_object('valid', v_valid, 'reason', 'duplicate', 'stopped', false);
  end if;

  select m.id into v_message
    from public.bwf_quote_email_message m
   where m.quote_uuid = v_quote
     and m.status = 'sent'
   order by m.sent_at desc nulls last
   limit 1;

  insert into public.bwf_quote_share_view (
    quote_uuid, quote_id, is_valid, reason, user_agent, ip_hash, referer, email_message_id
  )
  values (v_quote, coalesce(v_quote_id, ''), v_valid, v_reason, nullif(v_ua, ''), v_ip_hash, nullif(v_ref, ''), v_message);

  if not v_valid then
    return jsonb_build_object('valid', false, 'reason', coalesce(v_reason, 'rejected'), 'stopped', false);
  end if;

  insert into public.bwf_quote_email_settings as s (quote_uuid, status, first_viewed_at, auto_follow_up, stopped_at, stop_reason)
  values (v_quote, 'viewed', now(), false, now(), 'customer_viewed')
  on conflict (quote_uuid) do update
    set status = case when s.status = 'stopped' then 'stopped' else 'viewed' end,
        first_viewed_at = coalesce(s.first_viewed_at, now()),
        auto_follow_up = false,
        stopped_at = coalesce(s.stopped_at, now()),
        stop_reason = coalesce(s.stop_reason, 'customer_viewed'),
        updated_at = now();

  update public.bwf_quote_email_message
     set status = 'cancelled', updated_at = now()
   where quote_uuid = v_quote
     and kind = 'follow_up'
     and status = 'queued';

  return jsonb_build_object('valid', true, 'reason', null, 'stopped', true);
end;
$$;

revoke all on function public.record_quote_share_view(text, text, text, boolean) from public;
grant execute on function public.record_quote_share_view(text, text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
