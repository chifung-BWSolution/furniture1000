-- Integration test for an FDS test branch. Every fixture and model write is rolled back.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';
do $$
declare
  v_template public.fds_skp_devices%rowtype;
  v_device uuid := gen_random_uuid();
  v_job uuid := gen_random_uuid();
  v_lease uuid := gen_random_uuid();
  v_product text;
  v_old_skp uuid := gen_random_uuid();
  v_old_glb uuid := gen_random_uuid();
  v_role text;
  v_token text := 'fixture-' || gen_random_uuid()::text;
  v_hash text := repeat('a',64);
  v_result jsonb;
begin
  select * into v_template from public.fds_skp_devices
  where public.fds_skp_user_can_authorize(approved_by,approved_email) limit 1;
  if v_template.id is null then raise exception 'Test requires an existing authorized test-branch approver'; end if;
  select id into v_product from public.products p
  where not exists(select 1 from public.processing_jobs j where j.payload->>'product_id'=p.id and j.status in ('queued','running')) limit 1;
  if v_product is null then raise exception 'Test requires an idle product'; end if;
  insert into public.fds_skp_devices(id,installation_id,computer_name,environment,project_ref,approved_by,approved_email,expires_at,refresh_hash,refresh_expires_at,access_hash,access_expires_at,checks)
  values(v_device,gen_random_uuid(),'Native publication rollback fixture','branch','omxizeukbcqzsnjsuwod',v_template.approved_by,v_template.approved_email,now()+interval '1 hour','fixture',now()+interval '1 hour',public.fds_skp_sha256(v_token),now()+interval '1 hour','{"capabilities":["codex_v1"],"codex_ready":"true"}');
  insert into public.product_models(id,product_id,model_type,format,source,storage_path)
  values(v_old_skp,v_product,'su','skp','uploaded','fixture/'||v_old_skp||'.skp'),(v_old_glb,v_product,'3d','glb','uploaded','fixture/'||v_old_glb||'.glb');
  insert into public.processing_jobs(id,job_type,status,attempts,worker,payload)
  values(v_job,'generate_skp','running',1,v_device::text,jsonb_build_object('mode','codex_v1','product_id',v_product,'user_id',v_template.approved_by,'replace_model_ids',jsonb_build_array(v_old_skp,v_old_glb)));
  insert into public.fds_skp_job_leases(id,job_id,device_id,attempt,expires_at)
  values(v_lease,v_job,v_device,1,now()+interval '1 hour');
  foreach v_role in array array['fbx','fbx_bundle','glb','preview','validation','manifest','report'] loop
    insert into public.fds_skp_generation_artifacts(job_id,attempt,lease_id,role,storage_path,size_bytes,content_hash)
    values(v_job,1,v_lease,v_role,'fixture/'||v_job||'/'||v_role,100,v_hash);
    insert into storage.objects(bucket_id,name,metadata) values('product-models','fixture/'||v_job||'/'||v_role,'{"size":100}');
  end loop;
  v_result:=public.fds_skp_device_publish('invalid-fixture-token',v_lease,v_hash,true);
  if v_result->>'error' is distinct from 'unauthorized' then raise exception 'Unauthorized request accepted: %',v_result; end if;
  v_result:=public.fds_skp_device_publish(v_token,v_lease,v_hash,true);
  if v_result->>'error' is distinct from 'artifact_missing' or v_result->>'role' is distinct from 'skp' then raise exception 'Existing Codex contract lost required SKP: %',v_result; end if;
  update public.fds_skp_devices set checks='{"capabilities":["blender_v1"],"blender_ready":"true"}' where id=v_device;
  v_result:=public.fds_skp_device_publish(v_token,v_lease,v_hash,true);
  if v_result->>'verified' is distinct from 'true' then raise exception 'Blender no-SKP verification failed: %',v_result; end if;
  delete from public.fds_skp_generation_artifacts where job_id=v_job and role='glb';
  v_result:=public.fds_skp_device_publish(v_token,v_lease,v_hash,true);
  if v_result->>'error' is distinct from 'artifact_missing' or v_result->>'role' is distinct from 'glb' then raise exception 'Missing GLB accepted: %',v_result; end if;
  insert into public.fds_skp_generation_artifacts(job_id,attempt,lease_id,role,storage_path,size_bytes,content_hash)
  values(v_job,1,v_lease,'glb','fixture/'||v_job||'/glb',100,v_hash);
  v_result:=public.fds_skp_device_publish(v_token,v_lease,v_hash,false);
  if v_result->>'ok' is distinct from 'true' or v_result->'models' ? 'skp' or not (v_result->'models' ?& array['fbx','glb']) then raise exception 'Native partial publication failed: %',v_result; end if;
  if not exists(select 1 from public.product_models where id=v_old_skp) then raise exception 'Existing SKP was incorrectly retired'; end if;
  if exists(select 1 from public.product_models where id=v_old_glb) or not exists(select 1 from public.fds_product_models_retired where id=v_old_glb) then raise exception 'Requested GLB replacement did not retire safely'; end if;
  if (select count(*) from public.product_models where generation_job_id=v_job) <> 2 then raise exception 'Expected exactly FBX and GLB model records'; end if;
  if not exists(select 1 from public.processing_jobs where id=v_job and status='succeeded' and result->>'skp_status'='unavailable') then raise exception 'Completion state incorrect'; end if;
  v_result:=public.fds_skp_device_publish(v_token,v_lease,v_hash,false);
  if v_result->>'idempotent' is distinct from 'true' then raise exception 'Repeated publication not idempotent: %',v_result; end if;
end;
$$;
rollback;
