-- Delay automatic PM notifications by two hours. Let authorised customers
-- queue eligible requests immediately and keep the current cron worker host.

alter table public.bwf_quote_customer_request
  add column if not exists pm_notify_requested_at timestamptz;

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
        and (c.pm_notify_requested_at is not null or c.submitted_at <= now() - interval '2 hours')
        and c.pm_notify_attempts < 5
        and (c.last_notify_attempt_at is null or c.last_notify_attempt_at < now() - interval '5 minutes')
      order by c.pm_notify_requested_at asc nulls last, c.submitted_at asc
      limit v_limit
        for update skip locked
   )
  returning r.*;
end;
$$;

revoke all on function public.fds_quote_request_claim_notifications(integer) from public, anon, authenticated;
grant execute on function public.fds_quote_request_claim_notifications(integer) to service_role;

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
        and c.viewed_at <= now() - interval '2 hours'
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

create or replace function public.request_quote_pm_notification(p_request_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.bwf_quote_customer_request%rowtype;
  v_host text;
begin
  select r.* into v_request
    from public.bwf_quote_customer_request r
   where r.id = p_request_id
     and r.request_type not in ('confirm', 'reject')
     and (
       (public.bwf_active_share_quote(p_token) = r.quote_uuid and exists (
         select 1 from public.bwf_quote_share_links l
          where l.id = r.share_link_id and l.share_token = btrim(p_token)
       ))
       or (auth.uid() is not null and public.bwf_customer_can_access_quote(r.quote_uuid))
     )
   for update;
  if not found then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_request.pm_notified_at is not null then
    return 'sent';
  end if;
  if v_request.pm_email is null or v_request.pm_notify_attempts >= 5 then
    return 'unavailable';
  end if;
  if v_request.pm_notify_requested_at is not null then
    return 'queued';
  end if;

  update public.bwf_quote_customer_request
     set pm_notify_requested_at = now()
   where id = p_request_id;

  select substring(command from $host$https://[a-z0-9]+\.supabase\.co$host$)
    into v_host from cron.job where jobname = 'fds-notify-customer-request' limit 1;
  if v_host is not null then
    perform net.http_post(
      url := v_host || '/functions/v1/notify-customer-quote-request',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"customer"}'::jsonb,
      timeout_milliseconds := 5000
    );
  end if;
  return 'queued';
end;
$$;

revoke all on function public.request_quote_pm_notification(uuid, text) from public;
grant execute on function public.request_quote_pm_notification(uuid, text) to anon, authenticated;

-- Keep the existing worker and host, and wake it for view-only batches as well.
do $cron$
declare
  v_job record;
  v_where_position integer;
begin
  select jobid, command into v_job from cron.job where jobname = 'fds-notify-customer-request';
  if not found then
    return;
  end if;

  v_where_position := strpos(lower(v_job.command), 'where exists');
  if v_where_position = 0
     or strpos(v_job.command, '/functions/v1/notify-customer-quote-request') = 0 then
    raise exception 'Unexpected fds-notify-customer-request cron command';
  end if;

  perform cron.alter_job(v_job.jobid, schedule := '* * * * *', command :=
    left(v_job.command, v_where_position - 1) || $due$
      where exists (
        select 1 from public.bwf_quote_customer_request r
         where r.pm_notified_at is null and r.pm_notify_attempts < 5
           and (r.pm_notify_requested_at is not null or r.submitted_at <= now() - interval '2 hours')
           and (r.last_notify_attempt_at is null or r.last_notify_attempt_at < now() - interval '5 minutes')
      ) or exists (
        select 1 from public.bwf_quote_share_view v
         where v.is_valid and v.pm_notified_at is null and v.pm_notify_attempts < 5
           and v.viewed_at <= now() - interval '2 hours'
           and (v.last_notify_attempt_at is null or v.last_notify_attempt_at < now() - interval '5 minutes')
      );
    $due$);
end;
$cron$;

notify pgrst, 'reload schema';
