-- FDS-15 停信與發送競爭：
--   1. 停止自動跟進／客戶有效查看時，一併取消「已 claim（sending）」的跟進信。
--   2. Worker 真正寄出前呼叫 fds_quote_email_confirm_send：
--      - 訊息已被取消 → 不寄
--      - 跟進信在 claim 之後客戶已查看或該單已停止 → 取消並不寄
--      - 分享連結已失效 → 標記失敗並不寄
-- 仍有一個無法完全消除的窗口：confirm 之後、SMTP 接受之前的極短時間。
-- 這一點寫在交付文件，不假裝零誤差。

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
   where quote_uuid = p_quote_uuid
     and kind = 'follow_up'
     and status in ('queued', 'sending');
end;
$$;

revoke all on function public.fds_quote_email_stop(uuid, text) from public, anon;
grant execute on function public.fds_quote_email_stop(uuid, text) to authenticated;

create or replace function public.fds_quote_email_confirm_send(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.bwf_quote_email_message;
  v_status text;
  v_first_viewed timestamptz;
  v_active_link boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_message
    from public.bwf_quote_email_message
   where id = p_id
     for update;

  if v_message.id is null then
    return false;
  end if;
  if v_message.status <> 'sending' then
    return false;
  end if;

  if v_message.kind = 'follow_up' then
    select s.status, s.first_viewed_at
      into v_status, v_first_viewed
      from public.bwf_quote_email_settings s
     where s.quote_uuid = v_message.quote_uuid;

    if v_status in ('viewed', 'stopped') or v_first_viewed is not null then
      update public.bwf_quote_email_message
         set status = 'cancelled', updated_at = now()
       where id = p_id;
      return false;
    end if;
  end if;

  select exists (
    select 1
      from public.bwf_quote_share_links l
     where l.quote_uuid = v_message.quote_uuid
       and l.status = 'active'
       and (l.expires_at is null or l.expires_at > now())
  ) into v_active_link;

  if not v_active_link then
    update public.bwf_quote_email_message
       set status = 'failed',
           error = 'share_link_missing',
           updated_at = now()
     where id = p_id;
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.fds_quote_email_confirm_send(uuid) from public, anon, authenticated;
grant execute on function public.fds_quote_email_confirm_send(uuid) to service_role;

-- 有效查看：取消 queued 與已 claim（sending）的跟進信。
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
     and status in ('queued', 'sending');

  return jsonb_build_object('valid', true, 'reason', null, 'stopped', true);
end;
$$;

revoke all on function public.record_quote_share_view(text, text, text, boolean) from public;
grant execute on function public.record_quote_share_view(text, text, text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
