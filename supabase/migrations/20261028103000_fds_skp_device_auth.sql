-- SKP Worker browser pairing. The Windows installer no longer receives a service role key.
-- A device gets a revocable credential; service role stays on the edge function that proxies
-- generate_skp / preview_skp. Tables are not readable by authenticated clients.

create table if not exists public.fds_skp_device_pairings (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  device_proof_hash text not null,
  installation_id uuid not null,
  computer_name text not null,
  environment text not null check (environment in ('production', 'branch')),
  project_ref text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'claimed', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_by uuid,
  approved_email text,
  approved_at timestamptz,
  rejected_at timestamptz,
  claimed_at timestamptz,
  poll_not_before timestamptz,
  delivery_until timestamptz,
  delivery_cipher bytea,
  created_ip text
);

create index if not exists fds_skp_device_pairings_installation_idx
  on public.fds_skp_device_pairings (installation_id, created_at desc);

create table if not exists public.fds_skp_devices (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null unique,
  pairing_id uuid references public.fds_skp_device_pairings(id),
  computer_name text not null,
  environment text not null check (environment in ('production', 'branch')),
  project_ref text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'revoked', 'expired')),
  approved_by uuid not null,
  approved_email text,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  credential_version int not null default 1,
  refresh_hash text not null,
  previous_refresh_hash text,
  refresh_expires_at timestamptz not null,
  access_hash text,
  access_expires_at timestamptz,
  pending_rotation_id uuid,
  pending_refresh_hash text,
  pending_until timestamptz,
  pending_cipher bytea,
  last_heartbeat_at timestamptz,
  ready boolean not null default false,
  checks jsonb,
  worker_version text,
  current_job_id uuid,
  current_lease_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fds_skp_job_leases (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id),
  device_id uuid not null references public.fds_skp_devices(id),
  attempt int not null check (attempt > 0),
  status text not null default 'active'
    check (status in ('active', 'completed', 'failed', 'superseded')),
  expires_at timestamptz not null,
  upload_path text,
  upload_size bigint,
  upload_file_hash text,
  upload_expires_at timestamptz,
  content_hash text,
  created_at timestamptz not null default now(),
  unique (job_id, attempt)
);

create index if not exists fds_skp_job_leases_device_idx
  on public.fds_skp_job_leases (device_id, created_at desc);

create table if not exists public.fds_skp_device_audit (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  action text not null,
  result text not null,
  actor_user_id uuid,
  device_id uuid,
  pairing_id uuid,
  job_id uuid,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists fds_skp_device_audit_at_idx
  on public.fds_skp_device_audit (at desc);

create table if not exists public.fds_skp_auth_limits (
  bucket text primary key,
  window_start timestamptz not null,
  hits int not null
);

alter table public.fds_skp_workers
  add column if not exists device_id uuid;

alter table public.fds_skp_device_pairings enable row level security;
alter table public.fds_skp_devices enable row level security;
alter table public.fds_skp_job_leases enable row level security;
alter table public.fds_skp_device_audit enable row level security;
alter table public.fds_skp_auth_limits enable row level security;

revoke all on public.fds_skp_device_pairings from public, anon, authenticated;
revoke all on public.fds_skp_devices from public, anon, authenticated;
revoke all on public.fds_skp_job_leases from public, anon, authenticated;
revoke all on public.fds_skp_device_audit from public, anon, authenticated;
revoke all on public.fds_skp_auth_limits from public, anon, authenticated;
grant all on public.fds_skp_device_pairings to service_role;
grant all on public.fds_skp_devices to service_role;
grant all on public.fds_skp_job_leases to service_role;
grant all on public.fds_skp_device_audit to service_role;
grant all on public.fds_skp_auth_limits to service_role;

create or replace function public.fds_skp_sha256(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(coalesce(p_value, ''), 'utf8'), 'sha256'::text), 'hex');
$$;

create or replace function public.fds_skp_user_is_admin(p_user_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_user_profiles p
    where p.active is true
      and lower(p.role) = 'admin'
      and (
        (p_user_id is not null and p.auth_user_id = p_user_id)
        or (coalesce(btrim(p_email), '') <> '' and lower(p.email) = lower(p_email))
      )
  );
$$;

create or replace function public.fds_skp_audit(
  p_action text,
  p_result text,
  p_device_id uuid default null,
  p_pairing_id uuid default null,
  p_job_id uuid default null,
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fds_skp_device_audit (action, result, actor_user_id, device_id, pairing_id, job_id, detail)
  values (
    left(coalesce(p_action, 'unknown'), 80),
    left(coalesce(p_result, 'unknown'), 80),
    auth.uid(),
    p_device_id,
    p_pairing_id,
    p_job_id,
    coalesce(p_detail, '{}'::jsonb)
  );
end;
$$;

-- Returns seconds the caller must wait. 0 means the hit was allowed.
create or replace function public.fds_skp_rate_hit(p_bucket text, p_window interval, p_limit int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
  v_start timestamptz;
begin
  insert into public.fds_skp_auth_limits (bucket, window_start, hits)
  values (left(p_bucket, 200), now(), 1)
  on conflict (bucket) do update set
    window_start = case
      when public.fds_skp_auth_limits.window_start <= now() - p_window then now()
      else public.fds_skp_auth_limits.window_start
    end,
    hits = case
      when public.fds_skp_auth_limits.window_start <= now() - p_window then 1
      else public.fds_skp_auth_limits.hits + 1
    end
  returning hits, window_start into v_hits, v_start;
  if v_hits > p_limit then
    return greatest(1, ceil(extract(epoch from (v_start + p_window - now())))::int);
  end if;
  return 0;
end;
$$;

create or replace function public.fds_skp_assert_service()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
end;
$$;

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
          and public.fds_skp_user_is_admin(d.approved_by, d.approved_email)
        )
      )
  );
$$;

create or replace function public.fds_skp_preflight()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  return public.fds_skp_worker_available();
end;
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
        and public.fds_skp_user_is_admin(d.approved_by, d.approved_email)
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

create or replace function public.fds_request_skp(p_furniture_model_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
  v_status jsonb;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_model from public.furniture_models f
  where f.id = p_furniture_model_id
    and (f.created_by = auth.uid() or public.bwf_has_role(array['admin', 'uploader']))
  for update;
  if v_model.id is null then
    raise exception 'model_not_found' using errcode = 'P0002';
  end if;

  v_status := public.fds_skp_status_for(p_furniture_model_id);
  if v_status ->> 'status' in ('ready', 'queued', 'running') then
    return v_status;
  end if;

  if not public.fds_skp_worker_available() then
    raise exception 'skp_worker_unavailable';
  end if;

  insert into public.processing_jobs (job_type, payload, creator_staff_id)
  values (
    'generate_skp',
    jsonb_build_object('furniture_model_id', p_furniture_model_id, 'kind', v_model.kind),
    public.bwf_current_staff_id()
  );

  return public.fds_skp_status_for(p_furniture_model_id);
end;
$$;

create or replace function public.fds_skp_normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.fds_skp_public_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i int;
  v_byte int;
begin
  for v_i in 1..8 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    v_code := v_code || substr(alphabet, 1 + (v_byte % 32), 1);
  end loop;
  return v_code;
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
  if not public.fds_skp_user_is_admin(v.approved_by, v.approved_email) then
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

create or replace function public.fds_skp_device_gate(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_gate jsonb;
begin
  perform public.fds_skp_assert_service();
  if coalesce(p_access_token, '') = '' or length(p_access_token) > 200 then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  select id into v_id from public.fds_skp_devices
  where access_hash = public.fds_skp_sha256(p_access_token)
    and access_expires_at > now();
  if v_id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  v_gate := public.fds_skp_touch_device_auth(v_id);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  return jsonb_build_object('ok', true, 'device_id', v_id);
end;
$$;

create or replace function public.fds_skp_device_from_access(p_access_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb := public.fds_skp_device_gate(p_access_token);
begin
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return null;
  end if;
  return (v_gate ->> 'device_id')::uuid;
end;
$$;

create or replace function public.fds_skp_device_pair_start(
  p_installation_id uuid,
  p_device_secret text,
  p_computer_name text,
  p_environment text,
  p_project_ref text,
  p_ip text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wait int;
  v_code text;
  v_name text;
  v_id uuid;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  perform public.fds_skp_assert_service();
  if p_installation_id is null or coalesce(p_device_secret, '') = '' or length(p_device_secret) < 32 or length(p_device_secret) > 200 then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  if p_environment not in ('production', 'branch') or coalesce(p_project_ref, '') = '' then
    return jsonb_build_object('error', 'invalid_environment');
  end if;
  if (p_environment = 'production' and p_project_ref <> 'riaubhtruisbwdlwjzur')
     or (p_environment = 'branch' and p_project_ref <> 'omxizeukbcqzsnjsuwod') then
    return jsonb_build_object('error', 'environment_mismatch');
  end if;
  v_wait := public.fds_skp_rate_hit('pair-install:' || p_installation_id::text, interval '10 minutes', 5);
  if v_wait = 0 and coalesce(p_ip, '') <> '' then
    v_wait := public.fds_skp_rate_hit('pair-ip:' || left(p_ip, 64), interval '10 minutes', 20);
  end if;
  if v_wait > 0 then
    return jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', v_wait);
  end if;

  update public.fds_skp_device_pairings
  set status = 'cancelled'
  where installation_id = p_installation_id and status in ('pending', 'approved');

  v_name := left(regexp_replace(coalesce(nullif(btrim(p_computer_name), ''), 'Windows'), '[[:cntrl:]]', '', 'g'), 80);
  for i in 1..5 loop
    v_code := public.fds_skp_public_code();
    begin
      insert into public.fds_skp_device_pairings (
        public_code, device_proof_hash, installation_id, computer_name,
        environment, project_ref, expires_at, created_ip
      ) values (
        v_code, public.fds_skp_sha256(p_device_secret), p_installation_id, v_name,
        p_environment, p_project_ref, v_expires, left(coalesce(p_ip, ''), 64)
      ) returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;
    end;
  end loop;
  if v_id is null then
    return jsonb_build_object('error', 'unavailable');
  end if;
  perform public.fds_skp_audit('pair_create', 'pending', null, v_id, null,
    jsonb_build_object('environment', p_environment, 'project_ref', p_project_ref));
  return jsonb_build_object(
    'pairing_id', v_id,
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4),
    'expires_at', v_expires,
    'environment', p_environment,
    'computer_name', v_name,
    'retry_after_seconds', 5
  );
end;
$$;

create or replace function public.fds_skp_load_pairing(
  p_installation_id uuid,
  p_device_secret text
) returns public.fds_skp_device_pairings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_device_pairings%rowtype;
begin
  select * into v from public.fds_skp_device_pairings
  where installation_id = p_installation_id
    and status in ('pending', 'approved', 'claimed', 'rejected', 'expired')
  order by created_at desc
  limit 1
  for update;
  if v.id is null or v.device_proof_hash is distinct from public.fds_skp_sha256(p_device_secret) then
    return null;
  end if;
  if v.status = 'pending' and v.expires_at <= now() then
    update public.fds_skp_device_pairings set status = 'expired' where id = v.id;
    v.status := 'expired';
  end if;
  return v;
end;
$$;

create or replace function public.fds_skp_issue_initial(
  p_pair public.fds_skp_device_pairings,
  p_device_secret text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_access text := encode(extensions.gen_random_bytes(32), 'hex');
  v_refresh text := encode(extensions.gen_random_bytes(32), 'hex');
  v_access_expires timestamptz := now() + interval '15 minutes';
  v_refresh_expires timestamptz := now() + interval '30 days';
  v_payload text;
begin
  insert into public.fds_skp_devices (
    installation_id, pairing_id, computer_name, environment, project_ref,
    status, approved_by, approved_email, approved_at, expires_at,
    credential_version, refresh_hash, refresh_expires_at, access_hash, access_expires_at
  ) values (
    p_pair.installation_id, p_pair.id, p_pair.computer_name, p_pair.environment, p_pair.project_ref,
    'active', p_pair.approved_by, p_pair.approved_email, coalesce(p_pair.approved_at, now()), v_refresh_expires,
    1, public.fds_skp_sha256(v_refresh), v_refresh_expires, public.fds_skp_sha256(v_access), v_access_expires
  )
  on conflict (installation_id) do update set
    pairing_id = excluded.pairing_id,
    computer_name = excluded.computer_name,
    environment = excluded.environment,
    project_ref = excluded.project_ref,
    status = 'active',
    approved_by = excluded.approved_by,
    approved_email = excluded.approved_email,
    approved_at = excluded.approved_at,
    expires_at = excluded.expires_at,
    revoked_at = null,
    revoke_reason = null,
    credential_version = public.fds_skp_devices.credential_version + 1,
    refresh_hash = excluded.refresh_hash,
    previous_refresh_hash = null,
    refresh_expires_at = excluded.refresh_expires_at,
    access_hash = excluded.access_hash,
    access_expires_at = excluded.access_expires_at,
    pending_rotation_id = null,
    pending_refresh_hash = null,
    pending_until = null,
    pending_cipher = null,
    ready = false,
    updated_at = now()
  returning id into v_device_id;

  v_payload := jsonb_build_object(
    'device_id', v_device_id,
    'access_token', v_access,
    'refresh_token', v_refresh,
    'access_expires_at', v_access_expires,
    'refresh_expires_at', v_refresh_expires
  )::text;
  update public.fds_skp_device_pairings
  set status = 'claimed',
      claimed_at = coalesce(claimed_at, now()),
      delivery_until = now() + interval '10 minutes',
      delivery_cipher = extensions.pgp_sym_encrypt(v_payload, p_device_secret)
  where id = p_pair.id;
  perform public.fds_skp_audit('credential_issue', 'claimed', v_device_id, p_pair.id, null,
    jsonb_build_object('environment', p_pair.environment));
  return jsonb_build_object(
    'status', 'claimed',
    'device_id', v_device_id,
    'access_token', v_access,
    'refresh_token', v_refresh,
    'access_expires_at', v_access_expires,
    'refresh_expires_at', v_refresh_expires,
    'environment', p_pair.environment,
    'project_ref', p_pair.project_ref
  );
end;
$$;

create or replace function public.fds_skp_device_pair_poll(
  p_installation_id uuid,
  p_device_secret text,
  p_project_ref text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_device_pairings%rowtype;
  v_plain text;
begin
  perform public.fds_skp_assert_service();
  v := public.fds_skp_load_pairing(p_installation_id, p_device_secret);
  if v.id is null then
    return jsonb_build_object('error', 'invalid_pairing');
  end if;
  if v.project_ref is distinct from p_project_ref then
    return jsonb_build_object('error', 'environment_mismatch');
  end if;
  if v.poll_not_before is not null and v.poll_not_before > now() then
    return jsonb_build_object(
      'error', 'rate_limited',
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (v.poll_not_before - now())))::int)
    );
  end if;
  update public.fds_skp_device_pairings
  set poll_not_before = now() + interval '5 seconds'
  where id = v.id;

  if v.status = 'pending' then
    return jsonb_build_object('status', 'pending', 'expires_at', v.expires_at, 'retry_after_seconds', 5);
  end if;
  if v.status = 'rejected' then
    return jsonb_build_object('status', 'rejected');
  end if;
  if v.status = 'expired' then
    return jsonb_build_object('status', 'expired');
  end if;
  if v.status = 'approved' then
    return public.fds_skp_issue_initial(v, p_device_secret);
  end if;
  if v.status = 'claimed' and v.delivery_cipher is not null and v.delivery_until > now() then
    v_plain := extensions.pgp_sym_decrypt(v.delivery_cipher, p_device_secret);
    return (v_plain::jsonb) || jsonb_build_object('status', 'claimed', 'recovered', true, 'environment', v.environment, 'project_ref', v.project_ref);
  end if;
  return jsonb_build_object('status', 'already_delivered');
end;
$$;

create or replace function public.fds_skp_device_pair_cancel(
  p_installation_id uuid,
  p_device_secret text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_device_pairings%rowtype;
begin
  perform public.fds_skp_assert_service();
  v := public.fds_skp_load_pairing(p_installation_id, p_device_secret);
  if v.id is null then
    return jsonb_build_object('error', 'invalid_pairing');
  end if;
  if v.status in ('pending', 'approved') then
    update public.fds_skp_device_pairings set status = 'cancelled', delivery_cipher = null where id = v.id;
    perform public.fds_skp_audit('pair_cancel', 'cancelled', null, v.id, null, '{}'::jsonb);
  end if;
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.fds_skp_device_pair_ack(
  p_installation_id uuid,
  p_device_secret text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_device_pairings%rowtype;
begin
  perform public.fds_skp_assert_service();
  v := public.fds_skp_load_pairing(p_installation_id, p_device_secret);
  if v.id is null then
    return jsonb_build_object('error', 'invalid_pairing');
  end if;
  update public.fds_skp_device_pairings
  set delivery_cipher = null, delivery_until = null
  where id = v.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_refresh(
  p_device_id uuid,
  p_refresh_token text,
  p_next_refresh_token text,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_devices%rowtype;
  v_presented text := public.fds_skp_sha256(p_refresh_token);
  v_next text := public.fds_skp_sha256(p_next_refresh_token);
  v_gate jsonb;
  v_access text;
  v_access_expires timestamptz;
  v_plain text;
begin
  perform public.fds_skp_assert_service();
  if p_device_id is null or p_rotation_id is null
     or length(coalesce(p_refresh_token, '')) < 32
     or length(coalesce(p_next_refresh_token, '')) < 32
     or p_refresh_token = p_next_refresh_token then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  if public.fds_skp_rate_hit('refresh:' || p_device_id::text, interval '15 minutes', 40) > 0 then
    return jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', 15);
  end if;
  select * into v from public.fds_skp_devices where id = p_device_id for update;
  if v.id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  v_gate := public.fds_skp_touch_device_auth(v.id);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  select * into v from public.fds_skp_devices where id = p_device_id;

  if v.pending_rotation_id = p_rotation_id
     and v.pending_refresh_hash = v_next
     and v.previous_refresh_hash = v_presented
     and v.pending_until > now()
     and v.pending_cipher is not null then
    v_plain := extensions.pgp_sym_decrypt(v.pending_cipher, p_next_refresh_token);
    return (v_plain::jsonb) || jsonb_build_object('ok', true, 'recovered', true);
  end if;

  if v_presented = v.previous_refresh_hash
     and (v.pending_rotation_id is distinct from p_rotation_id or v.pending_refresh_hash is distinct from v_next) then
    update public.fds_skp_devices
    set status = 'revoked', revoked_at = now(), revoke_reason = 'refresh_replay',
        access_hash = null, access_expires_at = null, pending_cipher = null, ready = false, updated_at = now()
    where id = v.id;
    update public.fds_skp_workers set ready = false where device_id = v.id;
    perform public.fds_skp_audit('refresh_replay', 'revoked', v.id, v.pairing_id, null, '{}'::jsonb);
    return jsonb_build_object('error', 'revoked');
  end if;

  if v_presented is distinct from v.refresh_hash then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  if v.pending_rotation_id is not null and v.pending_until > now() and v.pending_rotation_id is distinct from p_rotation_id then
    update public.fds_skp_devices
    set status = 'revoked', revoked_at = now(), revoke_reason = 'refresh_replay',
        access_hash = null, access_expires_at = null, pending_cipher = null, ready = false, updated_at = now()
    where id = v.id;
    update public.fds_skp_workers set ready = false where device_id = v.id;
    perform public.fds_skp_audit('refresh_replay', 'revoked', v.id, v.pairing_id, null, '{}'::jsonb);
    return jsonb_build_object('error', 'revoked');
  end if;

  v_access := encode(extensions.gen_random_bytes(32), 'hex');
  v_access_expires := now() + interval '15 minutes';
  v_plain := jsonb_build_object(
    'device_id', v.id,
    'access_token', v_access,
    'refresh_token', p_next_refresh_token,
    'access_expires_at', v_access_expires,
    'refresh_expires_at', v.refresh_expires_at,
    'environment', v.environment,
    'project_ref', v.project_ref
  )::text;
  update public.fds_skp_devices set
    previous_refresh_hash = v.refresh_hash,
    refresh_hash = v_next,
    credential_version = credential_version + 1,
    access_hash = public.fds_skp_sha256(v_access),
    access_expires_at = v_access_expires,
    pending_rotation_id = p_rotation_id,
    pending_refresh_hash = v_next,
    pending_until = now() + interval '10 minutes',
    pending_cipher = extensions.pgp_sym_encrypt(v_plain, p_next_refresh_token),
    updated_at = now()
  where id = v.id;
  perform public.fds_skp_audit('refresh', 'rotated', v.id, v.pairing_id, null, '{}'::jsonb);
  return v_plain::jsonb || jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_refresh_ack(
  p_device_id uuid,
  p_refresh_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.fds_skp_devices%rowtype;
begin
  perform public.fds_skp_assert_service();
  select * into v from public.fds_skp_devices where id = p_device_id for update;
  if v.id is null or v.refresh_hash is distinct from public.fds_skp_sha256(p_refresh_token) then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  update public.fds_skp_devices
  set pending_cipher = null, pending_until = null, updated_at = now()
  where id = v.id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_disconnect(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform public.fds_skp_assert_service();
  v_id := public.fds_skp_device_from_access(p_access_token);
  if v_id is null then
    return jsonb_build_object('error', 'unauthorized');
  end if;
  update public.fds_skp_devices
  set status = 'revoked', revoked_at = now(), revoke_reason = 'local_disconnect',
      access_hash = null, pending_cipher = null, ready = false, updated_at = now()
  where id = v_id;
  update public.fds_skp_workers set ready = false where device_id = v_id;
  perform public.fds_skp_audit('disconnect', 'revoked', v_id, null, null, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_status(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v public.fds_skp_devices%rowtype;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  select * into v from public.fds_skp_devices where id = (v_gate ->> 'device_id')::uuid;
  return jsonb_build_object(
    'ok', true,
    'authorized', true,
    'status', v.status,
    'ready', v.ready and v.last_heartbeat_at > now() - interval '90 seconds',
    'checks', v.checks,
    'connected', v.last_heartbeat_at is not null and v.last_heartbeat_at > now() - interval '90 seconds',
    'environment', v.environment
  );
end;
$$;

create or replace function public.fds_skp_device_ready(
  p_access_token text,
  p_ready boolean,
  p_checks jsonb,
  p_version text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_id uuid;
  v public.fds_skp_devices%rowtype;
begin
  perform public.fds_skp_assert_service();
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  v_id := (v_gate ->> 'device_id')::uuid;
  if public.fds_skp_rate_hit('ready:' || v_id::text, interval '1 minute', 30) > 0 then
    return jsonb_build_object('error', 'rate_limited', 'retry_after_seconds', 5);
  end if;
  if p_checks is not null and octet_length(p_checks::text) > 4000 then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  update public.fds_skp_devices set
    ready = coalesce(p_ready, false),
    checks = p_checks,
    worker_version = left(coalesce(p_version, ''), 40),
    last_heartbeat_at = now(),
    updated_at = now()
  where id = v_id
  returning * into v;
  insert into public.fds_skp_workers (worker_id, ready, checks, checked_at, device_id)
  values (v.id::text, v.ready, v.checks, now(), v.id)
  on conflict (worker_id) do update set
    ready = excluded.ready,
    checks = excluded.checks,
    checked_at = excluded.checked_at,
    device_id = excluded.device_id;
  return jsonb_build_object(
    'ok', true,
    'authorized', true,
    'connected', true,
    'ready', v.ready,
    'checks', v.checks,
    'status', v.status
  );
end;
$$;

create or replace function public.fds_skp_device_claim(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_device uuid;
  v_slots int;
  v_job public.processing_jobs%rowtype;
  v_lease uuid;
  v_model public.furniture_models%rowtype;
  v_input jsonb;
begin
  perform public.fds_skp_assert_service();
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  v_device := (v_gate ->> 'device_id')::uuid;

  update public.processing_jobs
  set status = 'failed',
      error = coalesce(error, 'worker_timeout'),
      error_log = error_log || jsonb_build_array(jsonb_build_object('at', now(), 'attempt', attempts, 'error', 'worker_timeout')),
      finished_at = now(),
      updated_at = now()
  where status = 'running'
    and job_type in ('generate_skp', 'preview_skp')
    and heartbeat_at < now() - interval '10 minutes'
    and attempts >= max_attempts;

  update public.fds_skp_job_leases l
  set status = 'superseded'
  from public.processing_jobs j
  where l.job_id = j.id
    and l.status = 'active'
    and j.job_type in ('generate_skp', 'preview_skp')
    and j.status in ('failed', 'succeeded', 'cancelled');

  select greatest(0, 1 - count(*))::int into v_slots
  from public.processing_jobs
  where status = 'running'
    and job_type in ('generate_skp', 'preview_skp')
    and heartbeat_at >= now() - interval '10 minutes';
  if v_slots < 1 then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update public.processing_jobs j
  set status = 'running',
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      heartbeat_at = now(),
      worker = v_device::text,
      error = null,
      updated_at = now()
  where j.id = (
    select c.id from public.processing_jobs c
    where c.job_type in ('generate_skp', 'preview_skp')
      and c.attempts < c.max_attempts
      and (
        (c.status = 'queued' and c.run_after <= now())
        or (c.status = 'running' and c.heartbeat_at < now() - interval '10 minutes')
      )
    order by c.run_after, c.created_at
    limit 1
    for update skip locked
  )
  returning j.* into v_job;

  if v_job.id is null then
    return jsonb_build_object('ok', true, 'job', null);
  end if;

  update public.fds_skp_job_leases
  set status = 'superseded'
  where job_id = v_job.id and status = 'active';

  insert into public.fds_skp_job_leases (job_id, device_id, attempt, expires_at)
  values (v_job.id, v_device, v_job.attempts, now() + interval '10 minutes')
  returning id into v_lease;

  update public.fds_skp_devices
  set current_job_id = v_job.id, current_lease_id = v_lease, updated_at = now()
  where id = v_device;

  if v_job.job_type = 'generate_skp' then
    select * into v_model from public.furniture_models
    where id = (v_job.payload ->> 'furniture_model_id')::uuid;
    if v_model.id is null then
      perform public.fds_processing_job_fail(v_job.id, 'model_not_found', false);
      update public.fds_skp_job_leases set status = 'failed' where id = v_lease;
      return jsonb_build_object('ok', true, 'job', null);
    end if;
    v_input := jsonb_build_object('id', v_model.id, 'kind', v_model.kind, 'parametric', v_model.parametric);
  elsif v_job.job_type = 'preview_skp' then
    if coalesce(v_job.payload ->> 'storage_path', '') = ''
       or (v_job.payload ->> 'storage_path') like '%..%'
       or (v_job.payload ->> 'storage_path') !~ '^(uploaded|generated)/[A-Za-z0-9_./-]+\.skp$' then
      perform public.fds_skp_preview_job_fail(v_job.id, 'invalid_payload', false);
      update public.fds_skp_job_leases set status = 'failed' where id = v_lease;
      return jsonb_build_object('ok', true, 'job', null);
    end if;
    v_input := jsonb_build_object(
      'product_model_id', v_job.payload ->> 'product_model_id',
      'storage_path', v_job.payload ->> 'storage_path',
      'content_hash', v_job.payload ->> 'content_hash'
    );
  else
    return jsonb_build_object('error', 'forbidden');
  end if;

  perform public.fds_skp_audit('job_claim', 'running', v_device, null, v_job.id,
    jsonb_build_object('lease_id', v_lease, 'attempt', v_job.attempts, 'job_type', v_job.job_type));
  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id,
      'job_type', v_job.job_type,
      'lease_id', v_lease,
      'attempt', v_job.attempts,
      'expires_at', now() + interval '10 minutes',
      'input', v_input
    )
  );
end;
$$;

create or replace function public.fds_skp_lock_lease(
  p_access_token text,
  p_lease_id uuid
) returns public.fds_skp_job_leases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device uuid;
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
begin
  perform public.fds_skp_assert_service();
  v_device := public.fds_skp_device_from_access(p_access_token);
  if v_device is null then
    return null;
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id for update;
  if v_lease.id is null or v_lease.device_id <> v_device or v_lease.status <> 'active' then
    return null;
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id for update;
  if v_job.id is null or v_job.attempts <> v_lease.attempt or v_job.worker is distinct from v_device::text then
    update public.fds_skp_job_leases set status = 'superseded' where id = v_lease.id and status = 'active';
    return null;
  end if;
  if v_job.status <> 'running' or v_job.job_type not in ('generate_skp', 'preview_skp') then
    return null;
  end if;
  return v_lease;
end;
$$;

create or replace function public.fds_skp_device_job_touch(
  p_access_token text,
  p_lease_id uuid,
  p_progress numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_lease public.fds_skp_job_leases%rowtype;
  v_status text;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate || jsonb_build_object('stop', true);
  end if;
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected', 'stop', true);
  end if;
  v_status := public.fds_processing_job_heartbeat(v_lease.job_id, p_progress);
  if v_status is distinct from 'running' then
    return jsonb_build_object('error', 'stopped', 'stop', true, 'job_status', v_status);
  end if;
  update public.fds_skp_job_leases set expires_at = now() + interval '10 minutes' where id = v_lease.id;
  return jsonb_build_object('ok', true, 'stop', false, 'job_status', v_status);
end;
$$;

create or replace function public.fds_skp_device_input(
  p_access_token text,
  p_lease_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_path text;
begin
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id;
  if v_job.job_type <> 'preview_skp' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_path := v_job.payload ->> 'storage_path';
  if v_path is null or v_path like '%..%' or v_path !~ '^(uploaded|generated)/[A-Za-z0-9_./-]+\.skp$' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', v_path);
end;
$$;

create or replace function public.fds_skp_device_prepare_upload(
  p_access_token text,
  p_lease_id uuid,
  p_content_hash text,
  p_size_bytes bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_path text;
  v_model_id text;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$' or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 104857600 then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id;
  if v_job.job_type = 'generate_skp' then
    v_model_id := v_job.payload ->> 'furniture_model_id';
    v_path := 'generated/' || v_model_id || '/' || p_content_hash || '.skp';
  elsif v_job.job_type = 'preview_skp' then
    v_model_id := v_job.payload ->> 'product_model_id';
    v_path := 'preview/' || v_model_id || '/' || p_content_hash || '.glb';
  else
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_model_id is null or v_model_id !~ '^[0-9a-f-]{36}$' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  update public.fds_skp_job_leases set
    upload_path = v_path,
    upload_size = p_size_bytes,
    upload_file_hash = p_content_hash,
    upload_expires_at = now() + interval '5 minutes'
  where id = v_lease.id;
  return jsonb_build_object('ok', true, 'storage_path', v_path, 'expires_in', 300);
end;
$$;

create or replace function public.fds_skp_device_complete(
  p_access_token text,
  p_lease_id uuid,
  p_content_hash text,
  p_size_bytes bigint,
  p_storage_path text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_model public.furniture_models%rowtype;
  v_file text;
  v_register_hash text;
  v_done boolean;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id for update;
  if v_lease.id is null or v_lease.device_id is distinct from (v_gate ->> 'device_id')::uuid then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id for update;
  if v_job.status = 'succeeded'
     and (
       v_lease.content_hash = p_content_hash
       or v_job.result ->> 'storage_path' = p_storage_path
       or v_job.result ->> 'preview_storage_path' = p_storage_path
     ) then
    update public.fds_skp_job_leases
    set status = 'completed', content_hash = coalesce(v_lease.content_hash, p_content_hash)
    where id = v_lease.id and status <> 'completed';
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;
  if v_lease.status <> 'active' or v_job.attempts <> v_lease.attempt or v_job.worker is distinct from v_lease.device_id::text or v_job.status <> 'running' then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  if p_storage_path is distinct from v_lease.upload_path
     or p_content_hash is distinct from v_lease.upload_file_hash
     or p_size_bytes is distinct from v_lease.upload_size
     or v_lease.upload_expires_at is null
     or v_lease.upload_expires_at < now() then
    return jsonb_build_object('error', 'upload_rejected');
  end if;

  if v_job.job_type = 'generate_skp' then
    select * into v_model from public.furniture_models where id = (v_job.payload ->> 'furniture_model_id')::uuid;
    if v_model.id is null then
      return jsonb_build_object('error', 'model_not_found');
    end if;
    v_file := left(regexp_replace(coalesce(v_model.kind, 'model'), '[^A-Za-z0-9_-]', '', 'g'), 40);
    if v_file = '' then v_file := 'model'; end if;
    v_file := v_file || '-' || coalesce(v_model.parametric ->> 'width_mm', '0') || 'x'
      || coalesce(v_model.parametric ->> 'depth_mm', '0') || 'x'
      || coalesce(v_model.parametric ->> 'height_mm', '0') || '.skp';
    v_done := public.fds_skp_job_finish(v_job.id, p_storage_path, p_size_bytes, p_content_hash, v_file);
  elsif v_job.job_type = 'preview_skp' then
    v_register_hash := coalesce(nullif(v_job.payload ->> 'content_hash', ''), p_content_hash);
    v_done := public.fds_skp_preview_job_finish(v_job.id, p_storage_path, p_size_bytes, v_register_hash);
  else
    return jsonb_build_object('error', 'forbidden');
  end if;
  if not coalesce(v_done, false) then
    return jsonb_build_object('error', 'not_completed');
  end if;
  update public.fds_skp_job_leases
  set status = 'completed', content_hash = p_content_hash
  where id = v_lease.id;
  update public.fds_skp_devices
  set current_job_id = null, current_lease_id = null, updated_at = now()
  where id = v_lease.device_id;
  perform public.fds_skp_audit('job_complete', 'succeeded', v_lease.device_id, null, v_job.id,
    jsonb_build_object('lease_id', v_lease.id, 'bytes', p_size_bytes));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fds_skp_device_job_fail(
  p_access_token text,
  p_lease_id uuid,
  p_error text,
  p_retryable boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_status text;
begin
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected', 'stop', true);
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id;
  if v_job.job_type = 'preview_skp' then
    v_status := public.fds_skp_preview_job_fail(v_job.id, left(coalesce(p_error, 'failed'), 500), coalesce(p_retryable, true));
  else
    v_status := public.fds_processing_job_fail(v_job.id, left(coalesce(p_error, 'failed'), 500), coalesce(p_retryable, true));
  end if;
  update public.fds_skp_job_leases set status = 'failed' where id = v_lease.id;
  update public.fds_skp_devices
  set current_job_id = null, current_lease_id = null, updated_at = now()
  where id = v_lease.device_id;
  perform public.fds_skp_audit('job_fail', v_status, v_lease.device_id, null, v_job.id,
    jsonb_build_object('lease_id', v_lease.id));
  return jsonb_build_object('ok', true, 'job_status', v_status);
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
    'is_admin', public.bwf_has_role(array['admin'])
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
  perform public.bwf_assert_role(array['admin']);
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
  perform public.bwf_assert_role(array['admin']);
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
  perform public.bwf_assert_role(array['admin']);
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
  perform public.bwf_assert_role(array['admin']);
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

revoke all on function public.fds_skp_sha256(text) from public, anon, authenticated;
revoke all on function public.fds_skp_user_is_admin(uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_audit(text, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fds_skp_rate_hit(text, interval, int) from public, anon, authenticated;
revoke all on function public.fds_skp_assert_service() from public, anon, authenticated;
revoke all on function public.fds_skp_worker_available() from public, anon, authenticated;
revoke all on function public.fds_skp_normalize_code(text) from public, anon, authenticated;
revoke all on function public.fds_skp_public_code() from public, anon, authenticated;
revoke all on function public.fds_skp_touch_device_auth(uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_device_gate(text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_from_access(text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_pair_start(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fds_skp_load_pairing(uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_issue_initial(public.fds_skp_device_pairings, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_pair_poll(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_pair_cancel(uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_pair_ack(uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_refresh(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_device_refresh_ack(uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_disconnect(text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_status(text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_ready(text, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_claim(text) from public, anon, authenticated;
revoke all on function public.fds_skp_lock_lease(text, uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_device_job_touch(text, uuid, numeric) from public, anon, authenticated;
revoke all on function public.fds_skp_device_input(text, uuid) from public, anon, authenticated;
revoke all on function public.fds_skp_device_prepare_upload(text, uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.fds_skp_device_complete(text, uuid, text, bigint, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_job_fail(text, uuid, text, boolean) from public, anon, authenticated;

grant execute on function public.fds_skp_device_pair_start(uuid, text, text, text, text, text) to service_role;
grant execute on function public.fds_skp_device_pair_poll(uuid, text, text) to service_role;
grant execute on function public.fds_skp_device_pair_cancel(uuid, text) to service_role;
grant execute on function public.fds_skp_device_pair_ack(uuid, text) to service_role;
grant execute on function public.fds_skp_device_refresh(uuid, text, text, uuid) to service_role;
grant execute on function public.fds_skp_device_refresh_ack(uuid, text) to service_role;
grant execute on function public.fds_skp_device_disconnect(text) to service_role;
grant execute on function public.fds_skp_device_status(text) to service_role;
grant execute on function public.fds_skp_device_ready(text, boolean, jsonb, text) to service_role;
grant execute on function public.fds_skp_device_claim(text) to service_role;
grant execute on function public.fds_skp_device_job_touch(text, uuid, numeric) to service_role;
grant execute on function public.fds_skp_device_input(text, uuid) to service_role;
grant execute on function public.fds_skp_device_prepare_upload(text, uuid, text, bigint) to service_role;
grant execute on function public.fds_skp_device_complete(text, uuid, text, bigint, text) to service_role;
grant execute on function public.fds_skp_device_job_fail(text, uuid, text, boolean) to service_role;

revoke all on function public.fds_skp_device_pairing_lookup(text) from public, anon;
revoke all on function public.fds_skp_device_pairing_decide(text, boolean, text) from public, anon;
revoke all on function public.fds_skp_devices_admin_list() from public, anon;
revoke all on function public.fds_skp_device_admin_revoke(uuid, text) from public, anon;
revoke all on function public.fds_skp_device_admin_reapprove(uuid) from public, anon;
grant execute on function public.fds_skp_device_pairing_lookup(text) to authenticated;
grant execute on function public.fds_skp_device_pairing_decide(text, boolean, text) to authenticated;
grant execute on function public.fds_skp_devices_admin_list() to authenticated;
grant execute on function public.fds_skp_device_admin_revoke(uuid, text) to authenticated;
grant execute on function public.fds_skp_device_admin_reapprove(uuid) to authenticated;

notify pgrst, 'reload schema';
