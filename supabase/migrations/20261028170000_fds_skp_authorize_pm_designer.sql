-- SKP Worker 授權開放給 admin、pm、designer。
-- 裝置心跳仍會檢查批准人是否仍有授權資格；只改頁面、不改這裡的話，
-- PM／設計師批過的電腦會在下一次連線被標成 approver_role_removed。

create or replace function public.fds_skp_user_can_authorize(p_user_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_user_profiles p
    where p.active is true
      and lower(p.role) in ('admin', 'pm', 'designer')
      and (
        (p_user_id is not null and p.auth_user_id = p_user_id)
        or (coalesce(btrim(p_email), '') <> '' and lower(p.email) = lower(p_email))
      )
  );
$$;

revoke all on function public.fds_skp_user_can_authorize(uuid, text) from public, anon, authenticated;

create or replace function public.fds_skp_worker_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fds_skp_workers w
    left join public.fds_skp_devices d on d.id = w.device_id
    where w.ready
      and w.checked_at > now() - interval '90 seconds'
      and (
        w.device_id is null
        or (
          d.status = 'active'
          and d.expires_at > now()
          and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
        )
      )
  );
$$;

create or replace function public.fds_skp_preflight(p_details boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_worker public.fds_skp_workers%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select w.* into v_worker
  from public.fds_skp_workers w
  left join public.fds_skp_devices d on d.id = w.device_id
  where w.checked_at > now() - interval '90 seconds'
    and (
      w.device_id is null
      or (
        d.status = 'active'
        and d.expires_at > now()
        and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
      )
    )
  order by w.ready desc, w.checked_at desc
  limit 1;
  return jsonb_build_object(
    'ready', coalesce(v_worker.ready, false),
    'connected', v_worker.worker_id is not null,
    'checks', v_worker.checks
  );
end;
$$;

create or replace function public.fds_skp_touch_device_auth(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_devices%rowtype;
begin
  select * into v from public.fds_skp_devices where id = p_device_id for update;
  if v.id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if v.status = 'revoked' then
    return jsonb_build_object('error', 'revoked');
  end if;
  if v.status = 'expired' or v.refresh_expires_at <= now() or v.expires_at <= now() then
    update public.fds_skp_devices
    set status = 'expired', updated_at = now()
    where id = v.id and status <> 'revoked';
    return jsonb_build_object('error', 'expired');
  end if;
  if v.status = 'suspended' then
    return jsonb_build_object('error', 'suspended');
  end if;
  if not public.fds_skp_user_can_authorize(v.approved_by, v.approved_email) then
    update public.fds_skp_devices
    set status = 'suspended', revoke_reason = 'approver_role_removed', ready = false, updated_at = now()
    where id = v.id;
    update public.fds_skp_workers set ready = false where device_id = v.id;
    perform public.fds_skp_audit('suspend', 'approver_role_removed', v.id, v.pairing_id, null, '{}'::jsonb);
    return jsonb_build_object('error', 'suspended');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_pairing_lookup(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.fds_skp_normalize_code(p_code);
  v public.fds_skp_device_pairings%rowtype;
  v_wait int;
  v_can boolean := public.bwf_has_role(array['admin', 'pm', 'designer']);
begin
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  v_wait := public.fds_skp_rate_hit('lookup:' || auth.uid()::text, interval '10 minutes', 30);
  if v_wait > 0 then
    return jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', v_wait);
  end if;
  if length(v_code) <> 8 then
    return jsonb_build_object('error', 'not_found');
  end if;
  select * into v from public.fds_skp_device_pairings where public_code = v_code;
  if v.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v.status = 'pending' and v.expires_at <= now() then
    update public.fds_skp_device_pairings set status = 'expired' where id = v.id and status = 'pending';
    v.status := 'expired';
  end if;
  return jsonb_build_object(
    'code', substr(v.public_code, 1, 4) || '-' || substr(v.public_code, 5, 4),
    'environment', v.environment,
    'computer_name', v.computer_name,
    'status', v.status,
    'created_at', v.created_at,
    'expires_at', v.expires_at,
    'tasks', jsonb_build_array('generate_skp', 'preview_skp'),
    'can_authorize', v_can,
    'is_admin', v_can
  );
end;
$$;

create or replace function public.fds_skp_device_pairing_decide(
  p_code text,
  p_approve boolean,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := public.fds_skp_normalize_code(p_code);
  v public.fds_skp_device_pairings%rowtype;
  v_email text := left(coalesce(auth.jwt() ->> 'email', ''), 200);
  v_wait int;
begin
  perform public.bwf_assert_role(array['admin', 'pm', 'designer']);
  v_wait := public.fds_skp_rate_hit('decide:' || auth.uid()::text, interval '10 minutes', 30);
  if v_wait > 0 then
    return jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', v_wait);
  end if;
  select * into v from public.fds_skp_device_pairings where public_code = v_code for update;
  if v.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v.status = 'pending' and v.expires_at <= now() then
    update public.fds_skp_device_pairings set status = 'expired' where id = v.id;
    return jsonb_build_object('error', 'expired');
  end if;
  if v.status <> 'pending' then
    return jsonb_build_object('error', 'already_decided', 'status', v.status);
  end if;
  if coalesce(p_approve, false) then
    update public.fds_skp_device_pairings
    set status = 'approved', approved_by = auth.uid(), approved_email = v_email, approved_at = now()
    where id = v.id and status = 'pending';
    perform public.fds_skp_audit('approve', 'approved', null, v.id, null,
      jsonb_build_object('environment', v.environment));
    return jsonb_build_object('ok', true, 'status', 'approved');
  end if;
  update public.fds_skp_device_pairings
  set status = 'rejected', rejected_at = now()
  where id = v.id and status = 'pending';
  perform public.fds_skp_audit('reject', 'rejected', null, v.id, null,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

create or replace function public.fds_skp_devices_admin_list()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'pm', 'designer']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id,
      'computer_name', d.computer_name,
      'environment', d.environment,
      'worker_version', d.worker_version,
      'status', d.status,
      'revoke_reason', d.revoke_reason,
      'approved_at', d.approved_at,
      'expires_at', d.expires_at,
      'approver_email', d.approved_email,
      'last_heartbeat_at', d.last_heartbeat_at,
      'ready', d.ready and d.status = 'active' and d.last_heartbeat_at > now() - interval '90 seconds',
      'checks', d.checks,
      'current_job_id', case when j.status = 'running' then d.current_job_id else null end,
      'current_job_type', case when j.status = 'running' then j.job_type else null end
    ) order by d.created_at desc)
    from public.fds_skp_devices d
    left join public.processing_jobs j on j.id = d.current_job_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fds_skp_device_admin_revoke(p_device_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_devices%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'pm', 'designer']);
  select * into v from public.fds_skp_devices where id = p_device_id for update;
  if v.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  update public.fds_skp_devices
  set status = 'revoked', revoked_at = now(),
      revoke_reason = left(coalesce(nullif(btrim(p_reason), ''), 'admin_revoke'), 200),
      access_hash = null, pending_cipher = null, ready = false, updated_at = now()
  where id = v.id;
  update public.fds_skp_workers set ready = false, checked_at = now() where device_id = v.id;
  perform public.fds_skp_audit('revoke', 'revoked', v.id, v.pairing_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_admin_reapprove(p_device_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_devices%rowtype;
  v_email text := left(coalesce(auth.jwt() ->> 'email', ''), 200);
begin
  perform public.bwf_assert_role(array['admin', 'pm', 'designer']);
  select * into v from public.fds_skp_devices where id = p_device_id for update;
  if v.id is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  if v.status <> 'suspended' then
    return jsonb_build_object('error', 'not_suspended');
  end if;
  if v.approved_by = auth.uid() then
    return jsonb_build_object('error', 'different_admin_required');
  end if;
  update public.fds_skp_devices
  set status = 'active', approved_by = auth.uid(), approved_email = v_email,
      approved_at = now(), revoke_reason = null, updated_at = now()
  where id = v.id;
  perform public.fds_skp_audit('reapprove', 'active', v.id, v.pairing_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

notify pgrst, 'reload schema';
