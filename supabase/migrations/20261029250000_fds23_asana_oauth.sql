-- FDS-12：Asana 授權對齊 QMS —— 每位職員各自 OAuth 連接，token 只存 server side。
-- Web/edge 永不接收 token；worker 用 service role 讀取，必要時 refresh。
-- Cron（worker secret）沒有用戶身分，仍用 edge secret 的 ASANA_ACCESS_TOKEN 作系統連線。

create table if not exists public.fds_asana_oauth_tokens (
  auth_user_id uuid primary key,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  asana_user_gid text,
  asana_user_name text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fds_asana_oauth_tokens enable row level security;
revoke all on table public.fds_asana_oauth_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.fds_asana_oauth_tokens to service_role;

create or replace function public.fds_asana_oauth_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.fds_asana_oauth_tokens;
begin
  if auth.uid() is null then
    return jsonb_build_object('connected', false, 'reason', 'not_signed_in');
  end if;
  select * into v_row from public.fds_asana_oauth_tokens where auth_user_id = auth.uid();
  if v_row.auth_user_id is null then
    return jsonb_build_object('connected', false);
  end if;
  return jsonb_build_object(
    'connected', true,
    'asana_user_name', v_row.asana_user_name,
    'asana_user_gid', v_row.asana_user_gid,
    'expires_at', v_row.expires_at,
    'connected_at', v_row.connected_at
  );
end;
$$;

revoke all on function public.fds_asana_oauth_status() from public, anon;
grant execute on function public.fds_asana_oauth_status() to authenticated;

create or replace function public.fds_asana_oauth_disconnect()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  delete from public.fds_asana_oauth_tokens where auth_user_id = auth.uid();
end;
$$;

revoke all on function public.fds_asana_oauth_disconnect() from public, anon;
grant execute on function public.fds_asana_oauth_disconnect() to authenticated;

create or replace function public.fds_asana_oauth_save(
  p_auth_user_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_asana_user_gid text,
  p_asana_user_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_auth_user_id is null or coalesce(btrim(p_access_token), '') = '' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  insert into public.fds_asana_oauth_tokens (
    auth_user_id, access_token, refresh_token, expires_at, asana_user_gid, asana_user_name
  )
  values (
    p_auth_user_id,
    p_access_token,
    nullif(btrim(coalesce(p_refresh_token, '')), ''),
    p_expires_at,
    nullif(btrim(coalesce(p_asana_user_gid, '')), ''),
    nullif(btrim(coalesce(p_asana_user_name, '')), '')
  )
  on conflict (auth_user_id) do update
    set access_token = excluded.access_token,
        refresh_token = coalesce(excluded.refresh_token, public.fds_asana_oauth_tokens.refresh_token),
        expires_at = excluded.expires_at,
        asana_user_gid = excluded.asana_user_gid,
        asana_user_name = excluded.asana_user_name,
        updated_at = now();
end;
$$;

revoke all on function public.fds_asana_oauth_save(uuid, text, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.fds_asana_oauth_save(uuid, text, text, timestamptz, text, text) to service_role;

notify pgrst, 'reload schema';
