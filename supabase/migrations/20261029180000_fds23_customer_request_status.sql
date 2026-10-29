-- FDS-14 客戶提交：PM 在介面查看與處理。
-- 只改提交記錄的處理狀態，不動正式報價；正式報價仍由 PM 另行處理。

create or replace function public.fds_quote_customer_request_set_status(
  p_id uuid,
  p_status text
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
  if p_status not in ('submitted', 'acknowledged', 'converted', 'declined') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  update public.bwf_quote_customer_request
     set status = p_status,
         updated_at = now()
   where id = p_id;

  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.fds_quote_customer_request_set_status(uuid, text) from public, anon;
grant execute on function public.fds_quote_customer_request_set_status(uuid, text) to authenticated;

-- 同一個查詢回傳提交明細（lines），供 PM 面板顯示選品、數量與需求。
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
        r.lines,
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
