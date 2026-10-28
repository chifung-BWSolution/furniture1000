-- 辨認產品圖改走 processing_jobs（recognize_furniture）。
-- 瀏覽器只負責排隊；Gemini 由 generate-furniture-model 在 waitUntil 裡跑，
-- 離開頁面也不中斷。完成後 fds_furniture_recognition_status 把草稿交回開啟產品的人。
-- 不放進 process-jobs 的 JOB_TYPES：那條佇列一次只領一件，辨認會擋住 PDF。
-- 設計師讀不到 processing_jobs，狀態只經下面的 RPC。

create unique index if not exists processing_jobs_one_active_furniture_recognition
  on public.processing_jobs ((payload ->> 'product_id'), (payload ->> 'user_id'))
  where job_type = 'recognize_furniture' and status in ('queued', 'running');

create index if not exists processing_jobs_furniture_recognition_user_idx
  on public.processing_jobs ((payload ->> 'product_id'), (payload ->> 'user_id'), created_at desc)
  where job_type = 'recognize_furniture';

create or replace function public.fds_furniture_recognition_enqueue(
  p_product_id text,
  p_target text,
  p_image_urls jsonb,
  p_title text default null,
  p_width_mm numeric default null,
  p_depth_mm numeric default null,
  p_height_mm numeric default null,
  p_product_scope text default null,
  p_product_count int default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_staff uuid := public.bwf_current_staff_id();
  v_product public.products%rowtype;
  v_allowed text[] := array[]::text[];
  v_item jsonb;
  v_src text;
  v_url text;
  v_host text;
  v_authority text;
  v_path text;
  v_urls jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
  v_id uuid;
  v_width numeric;
  v_depth numeric;
  v_height numeric;
  v_scope text := nullif(btrim(coalesce(p_product_scope, '')), '');
  v_count int := p_product_count;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  if v_user is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_target not in ('skp', 'fbx') then
    raise exception '請選擇 SKP 或 FBX' using errcode = '22023';
  end if;
  if v_scope is not null and v_scope not in ('single', 'arrangement') then
    raise exception 'invalid_product_scope' using errcode = '22023';
  end if;
  if v_scope = 'arrangement' and (v_count is null or v_count < 2 or v_count > 20) then
    raise exception '請確認整組包含 2 至 20 件同款產品' using errcode = '22023';
  end if;
  if v_scope is distinct from 'arrangement' then
    v_count := null;
  end if;

  v_width := case when p_width_mm is not null and p_width_mm > 0 and p_width_mm <= 10000 then p_width_mm else null end;
  v_depth := case when p_depth_mm is not null and p_depth_mm > 0 and p_depth_mm <= 10000 then p_depth_mm else null end;
  v_height := case when p_height_mm is not null and p_height_mm > 0 and p_height_mm <= 10000 then p_height_mm else null end;

  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  v_allowed := array_remove(array[
    nullif(btrim(v_product.image_url), ''),
    nullif(btrim(v_product.image_url_2), ''),
    nullif(btrim(v_product.image_url_3), ''),
    nullif(btrim(v_product.lifestyle_image_url), '')
  ], null);

  if jsonb_typeof(v_product.images) = 'array' then
    for v_item in select value from jsonb_array_elements(v_product.images)
    loop
      v_src := case
        when jsonb_typeof(v_item) = 'string' then v_item #>> '{}'
        when jsonb_typeof(v_item) = 'object' then coalesce(v_item ->> 'src', v_item ->> 'url')
        else null
      end;
      if v_src like 'http%' then
        v_allowed := v_allowed || v_src;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_image_urls) is distinct from 'array'
     or jsonb_array_length(p_image_urls) < 2
     or jsonb_array_length(p_image_urls) > 6 then
    raise exception '請提供 2 至 6 張產品圖' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_image_urls)
  loop
    v_url := btrim(coalesce(v_item #>> '{}', ''));
    if v_url = any (v_seen) then
      continue;
    end if;
    if char_length(v_url) = 0 or char_length(v_url) > 2000 or v_url !~ '^https?://' then
      raise exception '圖片網址無效' using errcode = '22023';
    end if;
    v_authority := substring(v_url from '^https?://([^/]+)');
    if v_authority is null or position('@' in v_authority) > 0 then
      raise exception '圖片網址無效' using errcode = '22023';
    end if;
    v_host := lower(split_part(v_authority, ':', 1));
    if v_host in ('localhost', 'metadata.google.internal')
       or v_host like '%.local'
       or v_host ~ '^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[)' then
      raise exception '圖片網址無效' using errcode = '22023';
    end if;

    v_path := substring(v_url from '/storage/v1/object/public/product-images/([^?#]+)');
    if v_path is not null and v_path like 'products/%' and position(p_product_id || '_recognition' in v_path) > 0 then
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'product-images'
          and o.name = v_path
          and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 8000000
      ) then
        raise exception '找不到已上載的補充圖片' using errcode = '22023';
      end if;
    elsif not (v_url = any (v_allowed)) then
      raise exception '這張圖片不屬於此產品' using errcode = '22023';
    end if;

    v_seen := v_seen || v_url;
    v_urls := v_urls || jsonb_build_array(v_url);
  end loop;

  if coalesce(array_length(v_seen, 1), 0) < 2 then
    raise exception '最少需要 2 張不同圖片' using errcode = '22023';
  end if;

  select j.id into v_id
  from public.processing_jobs j
  where j.job_type = 'recognize_furniture'
    and j.payload ->> 'product_id' = p_product_id
    and j.payload ->> 'user_id' = v_user::text
    and j.status in ('queued', 'running')
  limit 1;
  if v_id is not null then
    return jsonb_build_object('jobId', v_id, 'alreadyQueued', true);
  end if;

  update public.processing_jobs
  set payload = payload || jsonb_build_object('acknowledged', true),
      updated_at = now()
  where job_type = 'recognize_furniture'
    and payload ->> 'product_id' = p_product_id
    and payload ->> 'user_id' = v_user::text
    and status in ('succeeded', 'failed', 'cancelled')
    and coalesce(payload ->> 'acknowledged', '') is distinct from 'true';

  begin
    insert into public.processing_jobs (job_type, payload, max_attempts, creator_staff_id)
    values (
      'recognize_furniture',
      jsonb_build_object(
        'product_id', p_product_id,
        'user_id', v_user,
        'target', p_target,
        'title', left(btrim(coalesce(p_title, '')), 200),
        'image_urls', v_urls,
        'width_mm', v_width,
        'depth_mm', v_depth,
        'height_mm', v_height,
        'product_scope', v_scope,
        'product_count', v_count
      ),
      2,
      v_staff
    )
    returning id into v_id;
  exception when unique_violation then
    select j.id into v_id
    from public.processing_jobs j
    where j.job_type = 'recognize_furniture'
      and j.payload ->> 'product_id' = p_product_id
      and j.payload ->> 'user_id' = v_user::text
      and j.status in ('queued', 'running')
    order by j.created_at desc
    limit 1;
    if v_id is null then
      raise;
    end if;
    return jsonb_build_object('jobId', v_id, 'alreadyQueued', true);
  end;

  return jsonb_build_object('jobId', v_id, 'alreadyQueued', false);
end;
$$;

create or replace function public.fds_furniture_recognition_status(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select * into v_job
  from public.processing_jobs
  where job_type = 'recognize_furniture'
    and payload ->> 'product_id' = p_product_id
    and payload ->> 'user_id' = auth.uid()::text
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('status', 'none');
  end if;
  if coalesce(v_job.payload ->> 'acknowledged', '') = 'true' and v_job.status not in ('queued', 'running') then
    return jsonb_build_object('status', 'none');
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'jobId', v_job.id,
    'status', v_job.status,
    'target', v_job.payload ->> 'target',
    'error', case when v_job.status = 'failed' then left(coalesce(v_job.error, '辨認失敗'), 500) else null end,
    'result', case when v_job.status = 'succeeded' then v_job.result else null end,
    'imageUrls', v_job.payload -> 'image_urls',
    'productScope', v_job.payload ->> 'product_scope',
    'productCount', v_job.payload -> 'product_count'
  ));
end;
$$;

create or replace function public.fds_furniture_recognition_ack(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_job
  from public.processing_jobs
  where id = p_job_id
    and job_type = 'recognize_furniture'
    and payload ->> 'user_id' = auth.uid()::text
  for update;
  if not found then
    return jsonb_build_object('jobId', p_job_id, 'acknowledged', false);
  end if;
  if v_job.status in ('queued', 'running') then
    raise exception '辨認仍在進行，請先取消' using errcode = '22023';
  end if;
  update public.processing_jobs
  set payload = payload || jsonb_build_object('acknowledged', true),
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('jobId', p_job_id, 'acknowledged', true);
end;
$$;

create or replace function public.fds_furniture_recognition_cancel(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  update public.processing_jobs
  set status = 'cancelled',
      payload = payload || jsonb_build_object('acknowledged', true),
      finished_at = now(),
      updated_at = now()
  where id = p_job_id
    and job_type = 'recognize_furniture'
    and payload ->> 'user_id' = auth.uid()::text
    and status in ('queued', 'running')
  returning * into v_job;
  if not found then
    return jsonb_build_object('jobId', p_job_id, 'cancelled', false);
  end if;
  return jsonb_build_object('jobId', p_job_id, 'cancelled', true);
end;
$$;

-- service_role only. The edge function passes the caller id; cron passes null and takes the next job.
create or replace function public.fds_furniture_recognition_claim(
  p_job_id uuid default null,
  p_user_id uuid default null,
  p_worker text default 'edge:generate-furniture-model'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
  v_stale interval := interval '2 minutes';
begin
  update public.processing_jobs
  set status = 'failed',
      error = coalesce(error, 'worker_timeout'),
      error_log = error_log || jsonb_build_array(jsonb_build_object(
        'at', now(), 'attempt', attempts, 'error', 'worker_timeout')),
      finished_at = now(),
      updated_at = now()
  where job_type = 'recognize_furniture'
    and status = 'running'
    and heartbeat_at < now() - v_stale
    and attempts >= max_attempts
    and (p_job_id is null or id = p_job_id);

  select * into v_job
  from public.processing_jobs
  where job_type = 'recognize_furniture'
    and (p_job_id is null or id = p_job_id)
    and (p_user_id is null or payload ->> 'user_id' = p_user_id::text)
    and attempts < max_attempts
    and (
      (status = 'queued' and run_after <= now())
      or (status = 'running' and heartbeat_at < now() - v_stale)
    )
  order by run_after, created_at
  limit 1
  for update skip locked;

  if not found then
    if p_job_id is not null then
      select * into v_job
      from public.processing_jobs
      where id = p_job_id
        and job_type = 'recognize_furniture'
        and (p_user_id is null or payload ->> 'user_id' = p_user_id::text);
      if not found then
        return null;
      end if;
      return jsonb_build_object('jobId', v_job.id, 'claimed', false, 'status', v_job.status);
    end if;
    return null;
  end if;

  update public.processing_jobs
  set status = 'running',
      attempts = attempts + 1,
      started_at = coalesce(started_at, now()),
      heartbeat_at = now(),
      worker = p_worker,
      error = null,
      updated_at = now()
  where id = v_job.id
  returning * into v_job;

  return jsonb_build_object(
    'jobId', v_job.id,
    'claimed', true,
    'status', v_job.status,
    'payload', v_job.payload
  );
end;
$$;

revoke all on function public.fds_furniture_recognition_enqueue(text, text, jsonb, text, numeric, numeric, numeric, text, int) from public, anon;
revoke all on function public.fds_furniture_recognition_status(text) from public, anon;
revoke all on function public.fds_furniture_recognition_ack(uuid) from public, anon;
revoke all on function public.fds_furniture_recognition_cancel(uuid) from public, anon;
revoke all on function public.fds_furniture_recognition_claim(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.fds_furniture_recognition_enqueue(text, text, jsonb, text, numeric, numeric, numeric, text, int) to authenticated;
grant execute on function public.fds_furniture_recognition_status(text) to authenticated;
grant execute on function public.fds_furniture_recognition_ack(uuid) to authenticated;
grant execute on function public.fds_furniture_recognition_cancel(uuid) to authenticated;
grant execute on function public.fds_furniture_recognition_claim(uuid, uuid, text) to service_role;

-- 每分鐘叫醒尚未被瀏覽器踢到的辨認。函式先回 202，辨認在 waitUntil 裡繼續。
do $cron$
declare
  v_host text;
  v_command text;
begin
  select substring(command from $re$https://[a-z0-9]+\.supabase\.co$re$)
    into v_host
  from cron.job
  where jobname = 'fds-process-jobs'
  limit 1;

  if v_host is null or v_host = '' then
    raise exception 'Cannot resolve function host from fds-process-jobs';
  end if;

  perform cron.unschedule('fds-furniture-recognition')
  from cron.job
  where jobname = 'fds-furniture-recognition';

  v_command := format($job$
    select net.http_post(
      url := %L || '/functions/v1/supabase-functions-generate-furniture-model',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fds_worker_secret' limit 1)
      ),
      body := '{"source":"cron"}'::jsonb,
      timeout_milliseconds := 8000
    )
    where exists (
      select 1 from public.processing_jobs
      where job_type = 'recognize_furniture'
        and (
          (status = 'queued' and run_after <= now() and attempts < max_attempts)
          -- Claim also closes the final attempt when its worker died.
          or (status = 'running' and heartbeat_at < now() - interval '2 minutes')
        )
    );
  $job$, v_host);

  perform cron.schedule('fds-furniture-recognition', '* * * * *', v_command);
end
$cron$;
