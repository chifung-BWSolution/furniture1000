/**
 * Exercises SKP device pairing against the FDS2.0 branch.
 * The whole check runs in one DO block, so a failure rolls the test rows back.
 */
import fs from 'node:fs';
import path from 'node:path';

const ref = 'omxizeukbcqzsnjsuwod';
const root = path.resolve(import.meta.dirname, '..');

function token() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
  const match = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m);
  if (!match) throw new Error('SUPABASE_ACCESS_TOKEN missing');
  return match[1].trim();
}

const sql = `
do $test$
declare
  v_admin uuid;
  v_email text;
  v_install uuid := '11111111-1111-4111-8111-111111111111';
  v_install2 uuid := '55555555-5555-4555-8555-555555555555';
  v_stranger uuid := '22222222-2222-4222-8222-222222222222';
  v_secret text := repeat('ab', 32);
  v_secret2 text := repeat('gh', 32);
  v_result jsonb;
  v_code text;
  v_device uuid;
  v_access text;
  v_refresh text;
  v_next text := repeat('cd', 32);
  v_rotation uuid := '33333333-3333-4333-8333-333333333333';
  v_model uuid := '66666666-6666-4666-8666-666666666666';
  v_other_model uuid := '77777777-7777-4777-8777-777777777777';
  v_claim jsonb;
  v_lease uuid;
  v_path text;
begin
  select p.auth_user_id, p.email into v_admin, v_email
  from public.platform_user_profiles p
  where p.active is true and lower(p.role) = 'admin' and p.auth_user_id is not null
  limit 1;
  if v_admin is null then
    raise exception 'FAIL no admin profile';
  end if;

  if has_function_privilege('anon', 'public.fds_skp_device_pair_start(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.fds_skp_device_pair_start(uuid,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.fds_skp_device_claim(text)', 'execute') then
    raise exception 'FAIL device proxy is executable by anon or authenticated';
  end if;

  perform set_config('request.jwt.claims', json_build_object('role','service_role','sub', v_admin)::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_result := public.fds_skp_device_pair_start(v_install, v_secret, 'TEST-PC', 'production', 'omxizeukbcqzsnjsuwod', '203.0.113.10');
  if v_result->>'error' is distinct from 'environment_mismatch' then
    raise exception 'FAIL cross-environment pair accepted %', v_result;
  end if;

  v_result := public.fds_skp_device_pair_start(v_install, v_secret, 'TEST-PC', 'branch', 'omxizeukbcqzsnjsuwod', '203.0.113.10');
  if v_result ? 'error' then raise exception 'FAIL pair %', v_result; end if;
  v_code := replace(v_result->>'code', '-', '');

  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub', v_stranger, 'email', 'nobody@example.com')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_stranger::text, true);
  perform set_config('request.jwt.claim.email', 'nobody@example.com', true);
  begin
    perform public.fds_skp_device_pairing_decide(v_code, true, null);
    raise exception 'FAIL non-admin approve succeeded';
  exception
    when sqlstate '42501' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub', v_admin, 'email', v_email)::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.email', v_email, true);
  v_result := public.fds_skp_device_pairing_decide(v_code, true, null);
  if v_result->>'status' is distinct from 'approved' then raise exception 'FAIL approve %', v_result; end if;
  v_result := public.fds_skp_device_pairing_decide(v_code, true, null);
  if v_result->>'error' is distinct from 'already_decided' then raise exception 'FAIL second approve %', v_result; end if;

  perform set_config('request.jwt.claims', json_build_object('role','service_role','sub', v_admin)::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.fds_skp_device_pair_poll(v_install, repeat('zz', 32), 'omxizeukbcqzsnjsuwod');
  if v_result->>'error' is distinct from 'invalid_pairing' then raise exception 'FAIL bad secret %', v_result; end if;
  update public.fds_skp_device_pairings set poll_not_before = null where installation_id = v_install;
  v_result := public.fds_skp_device_pair_poll(v_install, v_secret, 'riaubhtruisbwdlwjzur');
  if v_result->>'error' is distinct from 'environment_mismatch' then raise exception 'FAIL poll cross project %', v_result; end if;
  update public.fds_skp_device_pairings set poll_not_before = null where installation_id = v_install;
  v_result := public.fds_skp_device_pair_poll(v_install, v_secret, 'omxizeukbcqzsnjsuwod');
  if v_result->>'status' is distinct from 'claimed' or position('service_role' in v_result::text) > 0 then
    raise exception 'FAIL claim credential %', v_result;
  end if;
  v_device := (v_result->>'device_id')::uuid;
  v_access := v_result->>'access_token';
  v_refresh := v_result->>'refresh_token';
  update public.fds_skp_device_pairings set poll_not_before = null where installation_id = v_install;
  v_result := public.fds_skp_device_pair_poll(v_install, v_secret, 'omxizeukbcqzsnjsuwod');
  if v_result->>'access_token' is distinct from v_access then raise exception 'FAIL recovery created a new token'; end if;
  perform public.fds_skp_device_pair_ack(v_install, v_secret);
  update public.fds_skp_device_pairings set poll_not_before = null where installation_id = v_install;
  v_result := public.fds_skp_device_pair_poll(v_install, v_secret, 'omxizeukbcqzsnjsuwod');
  if v_result ? 'access_token' or v_result->>'status' is distinct from 'already_delivered' then
    raise exception 'FAIL ack still returns a token %', v_result;
  end if;

  v_result := public.fds_skp_device_refresh(v_device, v_refresh, v_next, v_rotation);
  if coalesce(v_result->>'access_token', '') = '' then raise exception 'FAIL refresh %', v_result; end if;
  v_access := v_result->>'access_token';
  v_result := public.fds_skp_device_refresh(v_device, v_refresh, repeat('ef', 32), '44444444-4444-4444-8444-444444444444');
  if v_result->>'error' is distinct from 'revoked' then raise exception 'FAIL replay was not revoked %', v_result; end if;

  insert into public.fds_skp_workers (worker_id, ready, checked_at, device_id)
  values (v_device::text, true, now(), v_device)
  on conflict (worker_id) do update set ready = true, checked_at = now(), device_id = excluded.device_id;
  if exists (
    select 1
    from public.fds_skp_workers w
    left join public.fds_skp_devices d on d.id = w.device_id
    where w.device_id = v_device
      and w.ready
      and w.checked_at > now() - interval '90 seconds'
      and (
        w.device_id is null
        or (
          d.status = 'active'
          and d.expires_at > now()
          and public.fds_skp_user_is_admin(d.approved_by, d.approved_email)
        )
      )
  ) then
    raise exception 'FAIL revoked device is still eligible';
  end if;

  v_result := public.fds_skp_device_pair_start(v_install2, v_secret2, 'TEST-PC-2', 'branch', 'omxizeukbcqzsnjsuwod', '203.0.113.11');
  if v_result ? 'error' then raise exception 'FAIL second pair %', v_result; end if;
  v_code := replace(v_result->>'code', '-', '');
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub', v_admin, 'email', v_email)::text, true);
  perform public.fds_skp_device_pairing_decide(v_code, true, null);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role','service_role','sub', v_admin)::text, true);
  update public.fds_skp_device_pairings set poll_not_before = null where installation_id = v_install2;
  v_result := public.fds_skp_device_pair_poll(v_install2, v_secret2, 'omxizeukbcqzsnjsuwod');
  v_device := (v_result->>'device_id')::uuid;
  v_access := v_result->>'access_token';

  insert into public.furniture_models (id, kind, parametric, created_by)
  values (v_model, 'desk', '{"width_mm":1200,"depth_mm":600,"height_mm":750,"label":"secret-desk","components":[{"id":"top","name":"top","size_mm":[1200,600,30],"position_mm":[0,0,360]}]}'::jsonb, v_admin);
  insert into public.furniture_models (id, kind, parametric, created_by)
  values (v_other_model, 'shelf', '{"width_mm":10,"depth_mm":10,"height_mm":10,"label":"other-model","components":[]}'::jsonb, v_admin);
  insert into public.processing_jobs (job_type, payload, status)
  values ('generate_skp', jsonb_build_object('furniture_model_id', v_other_model, 'kind', 'shelf'), 'queued');
  insert into public.processing_jobs (job_type, payload, status)
  values ('generate_skp', jsonb_build_object('furniture_model_id', v_model, 'kind', 'desk'), 'queued');

  v_claim := public.fds_skp_device_claim(v_access);
  if v_claim->'job'->>'job_type' is distinct from 'generate_skp' then raise exception 'FAIL claim %', v_claim; end if;
  if (v_claim->'job'->'input'->>'id')::uuid is distinct from v_model
     and (v_claim->'job'->'input'->>'id')::uuid is distinct from v_other_model then
    raise exception 'FAIL claim input %', v_claim->'job'->'input';
  end if;
  if position('other-model' in v_claim::text) > 0 and (v_claim->'job'->'input'->>'id')::uuid is distinct from v_other_model then
    raise exception 'FAIL claim leaked the other model';
  end if;
  if position(v_secret2 in v_claim::text) > 0 then raise exception 'FAIL claim returned a secret'; end if;
  v_lease := (v_claim->'job'->>'lease_id')::uuid;
  if v_claim->'job' is distinct from 'null'::jsonb and (public.fds_skp_device_claim(v_access)->'job') is distinct from 'null'::jsonb then
    raise exception 'FAIL second worker slot was issued';
  end if;
  v_result := public.fds_skp_device_job_touch(v_access, '88888888-8888-4888-8888-888888888888', 0.2);
  if coalesce(v_result->>'error', '') = '' then raise exception 'FAIL foreign lease accepted %', v_result; end if;

  v_path := 'generated/' || (v_claim->'job'->'input'->>'id') || '/' || repeat('a', 64) || '.skp';
  v_result := public.fds_skp_device_prepare_upload(v_access, v_lease, repeat('a', 64), 128);
  if v_result->>'storage_path' is distinct from v_path and v_result->>'storage_path' not like 'generated/%/' || repeat('a', 64) || '.skp' then
    raise exception 'FAIL upload path %', v_result;
  end if;
  v_path := v_result->>'storage_path';
  v_result := public.fds_skp_device_complete(v_access, v_lease, repeat('b', 64), 128, v_path);
  if v_result->>'error' is distinct from 'upload_rejected' then raise exception 'FAIL tampered hash %', v_result; end if;
  v_result := public.fds_skp_device_complete(v_access, v_lease, repeat('a', 64), 128, v_path);
  if v_result->>'ok' is distinct from 'true' then raise exception 'FAIL complete %', v_result; end if;
  v_result := public.fds_skp_device_complete(v_access, v_lease, repeat('a', 64), 128, v_path);
  if v_result->>'idempotent' is distinct from 'true' then raise exception 'FAIL duplicate complete %', v_result; end if;

  delete from public.product_models where furniture_model_id in (v_model, v_other_model);
  delete from public.fds_skp_job_leases where device_id in (select id from public.fds_skp_devices where installation_id in (v_install, v_install2));
  delete from public.processing_jobs where payload->>'furniture_model_id' in (v_model::text, v_other_model::text);
  delete from public.furniture_models where id in (v_model, v_other_model);
  delete from public.fds_skp_workers where device_id in (select id from public.fds_skp_devices where installation_id in (v_install, v_install2));
  delete from public.fds_skp_device_audit where device_id in (select id from public.fds_skp_devices where installation_id in (v_install, v_install2))
     or pairing_id in (select id from public.fds_skp_device_pairings where installation_id in (v_install, v_install2));
  delete from public.fds_skp_devices where installation_id in (v_install, v_install2);
  delete from public.fds_skp_device_pairings where installation_id in (v_install, v_install2);
  delete from public.fds_skp_auth_limits where bucket like 'pair-%' or bucket like 'decide:%' or bucket like 'lookup:%' or bucket like 'refresh:%' or bucket like 'ready:%';
end
$test$;
`;

const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await response.text();
if (!response.ok) {
  console.error(text.slice(0, 2000));
  process.exit(1);
}
console.log('PASS: device pairing, admin gate, replay revocation, lease isolation and idempotent completion');
console.log(text.slice(0, 300));
