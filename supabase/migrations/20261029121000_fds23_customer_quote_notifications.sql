-- FDS-14：客戶提交後通知該單負責 PM。
-- 以 claim → send → mark 的狀態機處理，並行 worker 不會重複發信；
-- 失敗保留 attempts 與錯誤，5 次後停止，可用 admin 重新排隊。

create or replace function public.fds_quote_request_claim_notifications(p_limit integer default 10)
returns setof public.bwf_quote_customer_request
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  if auth.role() is distinct from 'service_role'
     and not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return query
  update public.bwf_quote_customer_request r
     set pm_notify_attempts = r.pm_notify_attempts + 1,
         last_notify_attempt_at = now(),
         updated_at = now()
   where r.id in (
     select c.id
       from public.bwf_quote_customer_request c
      where c.pm_notified_at is null
        and c.pm_notify_attempts < 5
        and (c.last_notify_attempt_at is null or c.last_notify_attempt_at < now() - interval '5 minutes')
      order by c.submitted_at asc
      limit v_limit
        for update skip locked
   )
  returning r.*;
end;
$$;

revoke all on function public.fds_quote_request_claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.fds_quote_request_claim_notifications(integer) to service_role;

create or replace function public.fds_quote_request_mark_notified(
  p_id uuid,
  p_error text default null
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
  update public.bwf_quote_customer_request
     set pm_notified_at = case when nullif(btrim(coalesce(p_error, '')), '') is null then now() else pm_notified_at end,
         pm_notify_error = nullif(left(btrim(coalesce(p_error, '')), 500), ''),
         updated_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.fds_quote_request_mark_notified(uuid, text) from public, anon, authenticated;
grant execute on function public.fds_quote_request_mark_notified(uuid, text) to service_role;

-- 讓 PM 在 報價一覽 看到待處理的客戶提交（RLS 已限制 admin／uploader／pm）。
create or replace function public.fds_quote_customer_requests(
  p_quote_uuid uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(payload) order by payload.submitted_at desc)
    from (
      select
        r.id,
        r.quote_uuid,
        r.quote_id,
        r.request_type,
        r.note,
        r.total_cents,
        r.status,
        r.submitted_at,
        r.pm_name,
        r.pm_notified_at,
        r.pm_notify_error,
        jsonb_array_length(r.lines) as line_count
      from public.bwf_quote_customer_request r
      where (p_quote_uuid is null or r.quote_uuid = p_quote_uuid)
      order by r.submitted_at desc
      limit v_limit
    ) payload
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_quote_customer_requests(uuid, integer) from public, anon;
grant execute on function public.fds_quote_customer_requests(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
