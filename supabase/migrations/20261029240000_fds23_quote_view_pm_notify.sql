-- FDS-14 / FDS-15：客戶由電郵連結成功載入授權頁（有效查看）後，也要通知該單 PM。
-- 之前只記錄查看與停跟進信，沒有 PM 通知；這裡補狀態欄與 claim／mark RPC，
-- worker 以 service_role 處理，與客戶提交通知共用同一支 function。

alter table public.bwf_quote_share_view
  add column if not exists pm_notified_at timestamptz,
  add column if not exists pm_notify_attempts integer not null default 0,
  add column if not exists pm_notify_error text,
  add column if not exists last_notify_attempt_at timestamptz;

create index if not exists bwf_quote_share_view_pending_notify_idx
  on public.bwf_quote_share_view (viewed_at)
  where is_valid and pm_notified_at is null;

grant select, update on public.bwf_quote_share_view to service_role;

create or replace function public.fds_quote_view_claim_notifications(p_limit integer default 10)
returns setof public.bwf_quote_share_view
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  update public.bwf_quote_share_view v
     set pm_notify_attempts = v.pm_notify_attempts + 1,
         last_notify_attempt_at = now()
   where v.id in (
     select c.id
       from public.bwf_quote_share_view c
      where c.is_valid
        and c.pm_notified_at is null
        and c.pm_notify_attempts < 5
        and (c.last_notify_attempt_at is null or c.last_notify_attempt_at < now() - interval '5 minutes')
      order by c.viewed_at asc
      limit v_limit
        for update skip locked
   )
  returning v.*;
end;
$$;

revoke all on function public.fds_quote_view_claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.fds_quote_view_claim_notifications(integer) to service_role;

create or replace function public.fds_quote_view_mark_notified(p_id uuid, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  update public.bwf_quote_share_view
     set pm_notified_at = case when nullif(btrim(coalesce(p_error, '')), '') is null then now() else pm_notified_at end,
         pm_notify_error = nullif(left(btrim(coalesce(p_error, '')), 500), '')
   where id = p_id;
end;
$$;

revoke all on function public.fds_quote_view_mark_notified(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_quote_view_mark_notified(uuid, text) to service_role;

notify pgrst, 'reload schema';
