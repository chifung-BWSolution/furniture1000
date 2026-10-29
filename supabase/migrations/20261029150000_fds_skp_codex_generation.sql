-- 產品頁「生成 SKP」直接交本機 Codex 建模（docs/prd/FDS-本機Codex-SketchUp自動建模-PRD.md）。
-- 沿用 processing_jobs / generate_skp、裝置租約、product-models bucket 與 product_models。
-- 新工作 payload.mode = 'codex_v1'：不需要 furniture_model_id 或 parametric，
-- 只派給回報 capabilities 含 codex_v1 的 Worker；舊 Worker 領不到。
-- 一次工作要交 SKP、FBX（含貼圖 ZIP）、GLB、預覽圖、validation、manifest，
-- 全部登記在 fds_skp_generation_artifacts，最後由 fds_skp_device_publish 一次交易發布。

-- ── 前端入口開關：部署 DB 與 Worker 並驗證能力後才打開 ─────────────────────

create table if not exists public.fds_runtime_flags (
  key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.fds_runtime_flags enable row level security;
revoke all on public.fds_runtime_flags from public, anon, authenticated;
grant all on public.fds_runtime_flags to service_role;
insert into public.fds_runtime_flags (key, enabled) values ('skp_codex_entry', false)
on conflict (key) do nothing;

-- ── 產物與替換備份 ────────────────────────────────────────────────────────

create table if not exists public.fds_skp_generation_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  attempt int not null check (attempt > 0),
  lease_id uuid not null references public.fds_skp_job_leases(id),
  role text not null
    check (role in ('skp', 'fbx', 'fbx_bundle', 'glb', 'preview', 'validation', 'manifest', 'report')),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (job_id, attempt, role)
);
alter table public.fds_skp_generation_artifacts enable row level security;
revoke all on public.fds_skp_generation_artifacts from public, anon, authenticated;
grant all on public.fds_skp_generation_artifacts to service_role;

-- 明確替換時舊的 product_models 列移到這裡；Storage 物件保留到 purge_after。
create table if not exists public.fds_product_models_retired (
  id uuid primary key,
  product_id text,
  row_data jsonb not null,
  storage_paths text[] not null default array[]::text[],
  replaced_by_job_id uuid references public.processing_jobs(id) on delete set null,
  retired_at timestamptz not null default now(),
  purge_after timestamptz not null default now() + interval '30 days',
  purged_at timestamptz
);
alter table public.fds_product_models_retired enable row level security;
revoke all on public.fds_product_models_retired from public, anon, authenticated;
grant all on public.fds_product_models_retired to service_role;

alter table public.product_models
  add column if not exists generation_job_id uuid references public.processing_jobs(id) on delete set null,
  add column if not exists generation_mode text,
  add column if not exists bundle_storage_path text;

create unique index if not exists processing_jobs_one_active_codex_skp
  on public.processing_jobs ((payload ->> 'product_id'))
  where job_type = 'generate_skp' and payload ->> 'mode' = 'codex_v1' and status in ('queued', 'running');

create index if not exists processing_jobs_codex_skp_product_idx
  on public.processing_jobs ((payload ->> 'product_id'), created_at desc)
  where job_type = 'generate_skp' and payload ->> 'mode' = 'codex_v1';

-- ── 能力判斷 ──────────────────────────────────────────────────────────────

create or replace function public.fds_skp_device_has_codex(p_checks jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_checks -> 'capabilities', '[]'::jsonb) ? 'codex_v1'
     and coalesce(p_checks ->> 'codex_ready', '') = 'true';
$$;

create or replace function public.fds_skp_codex_worker_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.fds_skp_workers w
    join public.fds_skp_devices d on d.id = w.device_id
    where w.ready
      and w.checked_at > now() - interval '90 seconds'
      and d.status = 'active'
      and d.expires_at > now()
      and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
      and public.fds_skp_device_has_codex(d.checks)
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
  v_codex public.fds_skp_workers%rowtype;
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

  select w.* into v_codex
  from public.fds_skp_workers w
  join public.fds_skp_devices d on d.id = w.device_id
  where w.checked_at > now() - interval '90 seconds'
    and d.status = 'active'
    and d.expires_at > now()
    and public.fds_skp_user_can_authorize(d.approved_by, d.approved_email)
    and coalesce(d.checks -> 'capabilities', '[]'::jsonb) ? 'codex_v1'
  order by public.fds_skp_device_has_codex(d.checks) desc, w.checked_at desc
  limit 1;

  return jsonb_build_object(
    'ready', coalesce(v_worker.ready, false),
    'connected', v_worker.worker_id is not null,
    'checks', v_worker.checks,
    'codex_entry', coalesce((select f.enabled from public.fds_runtime_flags f where f.key = 'skp_codex_entry'), false),
    'codex_ready', coalesce(v_codex.ready, false) and public.fds_skp_device_has_codex(v_codex.checks),
    'codex_connected', v_codex.worker_id is not null,
    'codex_checks', v_codex.checks
  );
end;
$$;

-- ── 產品快照與參考圖 ──────────────────────────────────────────────────────

create or replace function public.fds_skp_plain_text(p_html text, p_limit int)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(
    replace(replace(replace(replace(replace(
      regexp_replace(coalesce(p_html, ''), '<[^>]*>', ' ', 'g'),
      '&nbsp;', ' '), '&amp;', '&'), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'),
    '[[:space:]]+', ' ', 'g')), p_limit), '');
$$;

-- Same allowlist as fds_furniture_recognition_enqueue: catalog images of this product, or
-- supplements uploaded through collectRecognitionUrls for this product.
create or replace function public.fds_skp_reference_images(p_product public.products, p_image_urls jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_item jsonb;
  v_src text;
  v_url text;
  v_authority text;
  v_host text;
  v_path text;
  v_seen text[] := array[]::text[];
  v_out jsonb := '[]'::jsonb;
  v_source text;
begin
  v_allowed := array_remove(array[
    nullif(btrim(p_product.image_url), ''),
    nullif(btrim(p_product.image_url_2), ''),
    nullif(btrim(p_product.image_url_3), ''),
    nullif(btrim(p_product.lifestyle_image_url), '')
  ], null);
  if jsonb_typeof(p_product.images) = 'array' then
    for v_item in select value from jsonb_array_elements(p_product.images)
    loop
      v_src := case
        when jsonb_typeof(v_item) = 'string' then v_item #>> '{}'
        when jsonb_typeof(v_item) = 'object' then coalesce(v_item ->> 'src', v_item ->> 'url')
      end;
      if v_src like 'http%' then
        v_allowed := v_allowed || v_src;
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_image_urls) is distinct from 'array'
     or jsonb_array_length(p_image_urls) < 1
     or jsonb_array_length(p_image_urls) > 8 then
    raise exception 'reference_images_required' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_image_urls)
  loop
    v_url := btrim(coalesce(v_item #>> '{}', ''));
    if v_url = any (v_seen) then
      continue;
    end if;
    if char_length(v_url) = 0 or char_length(v_url) > 2000 or v_url !~ '^https://' then
      raise exception 'reference_image_invalid' using errcode = '22023';
    end if;
    v_authority := substring(v_url from '^https://([^/]+)');
    if v_authority is null or position('@' in v_authority) > 0 then
      raise exception 'reference_image_invalid' using errcode = '22023';
    end if;
    v_host := lower(split_part(v_authority, ':', 1));
    if v_host in ('localhost', 'metadata.google.internal')
       or v_host like '%.local'
       or v_host ~ '^(127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[)' then
      raise exception 'reference_image_invalid' using errcode = '22023';
    end if;
    v_path := substring(v_url from '/storage/v1/object/public/product-images/([^?#]+)');
    if v_path is not null and v_path like 'products/%' and position(p_product.id || '_recognition' in v_path) > 0 then
      if not exists (
        select 1 from storage.objects o
        where o.bucket_id = 'product-images'
          and o.name = v_path
          and coalesce((o.metadata ->> 'size')::bigint, 0) between 1 and 8000000
      ) then
        raise exception 'reference_image_missing' using errcode = '22023';
      end if;
      v_source := 'supplement';
    elsif v_url = any (v_allowed) then
      v_source := 'catalog';
    else
      raise exception 'reference_image_not_product' using errcode = '22023';
    end if;
    v_seen := v_seen || v_url;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'url', v_url, 'order', coalesce(array_length(v_seen, 1), 0), 'source', v_source));
  end loop;
  return v_out;
end;
$$;

create or replace function public.fds_skp_product_snapshot(p_product public.products, p_request_id uuid, p_references jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'schema_version', 1,
    'request_id', p_request_id,
    'mode', 'codex_v1',
    'formats', jsonb_build_array('skp', 'fbx', 'glb'),
    'product', jsonb_strip_nulls(jsonb_build_object(
      'id', p_product.id,
      'name', left(btrim(coalesce(p_product.title, '')), 300),
      'model', nullif(left(btrim(coalesce(p_product.model, '')), 120), ''),
      'sku', nullif(left(btrim(coalesce(p_product.sku, '')), 120), ''),
      'category', nullif(concat_ws(' / ', nullif(btrim(p_product.level1_category), ''), nullif(btrim(p_product.level2_category), ''), nullif(btrim(p_product.category), '')), ''),
      'material', nullif(left(btrim(coalesce(p_product.material, '')), 500), ''),
      'color', nullif(left(btrim(coalesce(p_product.color, '')), 300), ''),
      'specifications', public.fds_skp_plain_text(p_product.specifications, 2000),
      'description', public.fds_skp_plain_text(coalesce(nullif(p_product.description_html, ''), p_product.description), 4000)
    )),
    -- Catalog record dimensions. A chosen image may show another size variant; Codex decides and reports.
    'catalog_dimensions_mm', jsonb_build_object(
      'width', case when p_product.dimension_l_mm > 0 and p_product.dimension_l_mm <= 20000 then p_product.dimension_l_mm end,
      'depth', case when p_product.dimension_w_mm > 0 and p_product.dimension_w_mm <= 20000 then p_product.dimension_w_mm end,
      'height', case when p_product.dimension_h_mm > 0 and p_product.dimension_h_mm <= 20000 then p_product.dimension_h_mm end
    ),
    'references', p_references
  );
$$;

-- ── 前端：排隊、狀態、取消 ────────────────────────────────────────────────

create or replace function public.fds_product_skp_job_json(p_job public.processing_jobs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p_job.id is null then jsonb_build_object('status', 'none') else jsonb_strip_nulls(jsonb_build_object(
    'status', p_job.status,
    'job_id', p_job.id,
    'request_id', p_job.payload ->> 'request_id',
    'stage', p_job.result ->> 'stage',
    'stage_detail', p_job.result ->> 'stage_detail',
    'stage_at', p_job.result ->> 'stage_at',
    'progress', p_job.progress,
    'attempts', p_job.attempts,
    'max_attempts', p_job.max_attempts,
    'error', p_job.error,
    'replace', jsonb_array_length(coalesce(p_job.payload -> 'replace_model_ids', '[]'::jsonb)) > 0,
    'reference_count', jsonb_array_length(coalesce(p_job.payload #> '{snapshot,references}', '[]'::jsonb)),
    'models', p_job.result -> 'models',
    'created_at', p_job.created_at,
    'started_at', p_job.started_at,
    'finished_at', p_job.finished_at
  )) end;
$$;

create or replace function public.fds_product_skp_status(p_product_id text)
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
  select * into v_job from public.processing_jobs j
  where j.job_type = 'generate_skp'
    and j.payload ->> 'mode' = 'codex_v1'
    and j.payload ->> 'product_id' = p_product_id
  order by j.created_at desc
  limit 1;
  return public.fds_product_skp_job_json(v_job);
end;
$$;

create or replace function public.fds_request_product_skp(
  p_product_id text,
  p_request_id uuid,
  p_image_urls jsonb,
  p_replace_model_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
  v_job public.processing_jobs%rowtype;
  v_refs jsonb;
  v_replace uuid[];
  v_key text;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  if v_user is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_id_required' using errcode = '22023';
  end if;
  v_key := 'skp-codex:' || p_request_id::text;

  -- Double click / network resend with the same request id: same job.
  select * into v_job from public.processing_jobs where idempotency_key = v_key;
  if v_job.id is not null then
    if v_job.payload ->> 'product_id' is distinct from p_product_id then
      raise exception 'request_id_conflict' using errcode = '22023';
    end if;
    return public.fds_product_skp_job_json(v_job) || jsonb_build_object('already_queued', true);
  end if;

  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;

  select * into v_job from public.processing_jobs j
  where j.job_type = 'generate_skp' and j.payload ->> 'mode' = 'codex_v1'
    and j.payload ->> 'product_id' = p_product_id and j.status in ('queued', 'running')
  limit 1;
  if v_job.id is not null then
    return public.fds_product_skp_job_json(v_job) || jsonb_build_object('already_queued', true);
  end if;

  if not coalesce((select f.enabled from public.fds_runtime_flags f where f.key = 'skp_codex_entry'), false) then
    raise exception 'codex_entry_disabled' using errcode = '42501';
  end if;
  if not public.fds_skp_codex_worker_available() then
    raise exception 'codex_worker_unavailable';
  end if;

  v_refs := public.fds_skp_reference_images(v_product, p_image_urls);

  select coalesce(array_agg(m.id), array[]::uuid[]) into v_replace
  from public.product_models m
  where m.product_id = p_product_id and m.id = any (coalesce(p_replace_model_ids, array[]::uuid[]));
  if coalesce(array_length(p_replace_model_ids, 1), 0) <> coalesce(array_length(v_replace, 1), 0) then
    raise exception 'replace_model_not_found' using errcode = 'P0002';
  end if;

  begin
    insert into public.processing_jobs (job_type, payload, max_attempts, idempotency_key, creator_staff_id)
    values (
      'generate_skp',
      jsonb_build_object(
        'mode', 'codex_v1',
        'schema_version', 1,
        'product_id', p_product_id,
        'request_id', p_request_id,
        'user_id', v_user,
        'replace_model_ids', to_jsonb(v_replace),
        'snapshot', public.fds_skp_product_snapshot(v_product, p_request_id, v_refs)
      ),
      2,
      v_key,
      public.bwf_current_staff_id()
    )
    returning * into v_job;
  exception when unique_violation then
    select * into v_job from public.processing_jobs j
    where j.idempotency_key = v_key
       or (j.job_type = 'generate_skp' and j.payload ->> 'mode' = 'codex_v1'
           and j.payload ->> 'product_id' = p_product_id and j.status in ('queued', 'running'))
    order by j.created_at desc
    limit 1;
    if v_job.id is null then
      raise;
    end if;
    return public.fds_product_skp_job_json(v_job) || jsonb_build_object('already_queued', true);
  end;
  return public.fds_product_skp_job_json(v_job) || jsonb_build_object('already_queued', false);
end;
$$;

create or replace function public.fds_product_skp_cancel(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  update public.processing_jobs j
  set status = 'cancelled', finished_at = now(), updated_at = now(),
      result = coalesce(j.result, '{}'::jsonb) || jsonb_build_object('stage', 'cancelled', 'stage_at', now())
  where j.id = p_job_id
    and j.job_type = 'generate_skp'
    and j.payload ->> 'mode' = 'codex_v1'
    and j.status in ('queued', 'running')
    and (j.payload ->> 'user_id' = auth.uid()::text or public.bwf_has_role(array['admin', 'uploader']))
  returning * into v_job;
  if v_job.id is null then
    select * into v_job from public.processing_jobs where id = p_job_id and job_type = 'generate_skp';
  end if;
  return public.fds_product_skp_job_json(v_job);
end;
$$;

-- ── Worker：領取（按能力派發；每台裝置一次一件）────────────────────────────

create or replace function public.fds_skp_device_claim(p_access_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_device uuid;
  v_device_row public.fds_skp_devices%rowtype;
  v_codex boolean;
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
  select * into v_device_row from public.fds_skp_devices where id = v_device;
  v_codex := public.fds_skp_device_has_codex(v_device_row.checks);

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

  -- One SketchUp job per device; the Worker also holds a machine-wide lock.
  if exists (
    select 1 from public.processing_jobs
    where status = 'running'
      and job_type in ('generate_skp', 'preview_skp')
      and worker = v_device::text
      and heartbeat_at >= now() - interval '10 minutes'
  ) then
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
      and (c.payload ->> 'mode' is distinct from 'codex_v1' or v_codex)
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

  if v_job.job_type = 'generate_skp' and v_job.payload ->> 'mode' = 'codex_v1' then
    if (v_job.payload #>> '{snapshot,schema_version}') is distinct from '1'
       or jsonb_typeof(v_job.payload #> '{snapshot,references}') is distinct from 'array' then
      perform public.fds_processing_job_fail(v_job.id, 'invalid_payload', false);
      update public.fds_skp_job_leases set status = 'failed' where id = v_lease;
      return jsonb_build_object('ok', true, 'job', null);
    end if;
    v_input := (v_job.payload -> 'snapshot') || jsonb_build_object(
      'job_id', v_job.id,
      'attempt', v_job.attempts,
      'environment', v_device_row.environment,
      'project_ref', v_device_row.project_ref,
      'replace', jsonb_array_length(coalesce(v_job.payload -> 'replace_model_ids', '[]'::jsonb)) > 0
    );
  elsif v_job.job_type = 'generate_skp' then
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
    jsonb_build_object('lease_id', v_lease, 'attempt', v_job.attempts, 'job_type', v_job.job_type,
      'mode', coalesce(v_job.payload ->> 'mode', 'parametric')));
  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id,
      'job_type', v_job.job_type,
      'mode', coalesce(v_job.payload ->> 'mode', 'parametric'),
      'lease_id', v_lease,
      'attempt', v_job.attempts,
      'expires_at', now() + interval '10 minutes',
      'input', v_input
    )
  );
end;
$$;

-- ── Worker：階段心跳 ──────────────────────────────────────────────────────

create or replace function public.fds_skp_device_job_stage(
  p_access_token text,
  p_lease_id uuid,
  p_stage text,
  p_progress numeric,
  p_detail text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_touch jsonb;
  v_lease public.fds_skp_job_leases%rowtype;
begin
  if p_stage not in ('download', 'wait_sketchup', 'codex', 'export', 'validate', 'upload', 'publish') then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  v_touch := public.fds_skp_device_job_touch(p_access_token, p_lease_id, p_progress);
  if coalesce(v_touch ->> 'ok', '') <> 'true' then
    return v_touch;
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id;
  update public.processing_jobs
  set result = coalesce(result, '{}'::jsonb) || jsonb_build_object(
        'stage', p_stage,
        'stage_detail', left(coalesce(p_detail, ''), 300),
        'stage_at', now())
  where id = v_lease.job_id and status = 'running';
  return v_touch;
end;
$$;

-- ── Worker：多產物上傳與發布 ──────────────────────────────────────────────

create or replace function public.fds_skp_device_artifact_prepare(
  p_access_token text,
  p_lease_id uuid,
  p_role text,
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
  v_ext text;
  v_limit bigint;
  v_path text;
begin
  if p_content_hash !~ '^[0-9a-f]{64}$' or p_size_bytes is null or p_size_bytes < 1 then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  select ext, lim into v_ext, v_limit from (values
    ('skp', 'skp', 104857600::bigint),
    ('fbx', 'fbx', 104857600::bigint),
    ('fbx_bundle', 'zip', 104857600::bigint),
    ('glb', 'glb', 104857600::bigint),
    ('preview', 'png', 15728640::bigint),
    ('validation', 'json', 2097152::bigint),
    ('manifest', 'json', 2097152::bigint),
    ('report', 'json', 2097152::bigint)
  ) as r(role, ext, lim) where r.role = p_role;
  if v_ext is null or p_size_bytes > v_limit then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id;
  if v_job.job_type <> 'generate_skp' or v_job.payload ->> 'mode' is distinct from 'codex_v1' then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_path := 'generated/codex/' || v_job.id::text || '/a' || v_lease.attempt::text || '/'
    || replace(p_role, '_', '-') || '-' || p_content_hash || '.' || v_ext;
  insert into public.fds_skp_generation_artifacts (job_id, attempt, lease_id, role, storage_path, size_bytes, content_hash)
  values (v_job.id, v_lease.attempt, v_lease.id, p_role, v_path, p_size_bytes, p_content_hash)
  on conflict (job_id, attempt, role) do update set
    lease_id = excluded.lease_id,
    storage_path = excluded.storage_path,
    size_bytes = excluded.size_bytes,
    content_hash = excluded.content_hash,
    created_at = now();
  return jsonb_build_object('ok', true, 'storage_path', v_path, 'expires_in', 300);
end;
$$;

-- Read back what this lease uploaded (the Worker re-downloads and checks SHA-256).
create or replace function public.fds_skp_device_artifact_path(
  p_access_token text,
  p_lease_id uuid,
  p_role text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lease public.fds_skp_job_leases%rowtype;
  v_path text;
begin
  v_lease := public.fds_skp_lock_lease(p_access_token, p_lease_id);
  if v_lease.id is null then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select a.storage_path into v_path from public.fds_skp_generation_artifacts a
  where a.job_id = v_lease.job_id and a.attempt = v_lease.attempt and a.lease_id = v_lease.id and a.role = p_role;
  if v_path is null then
    return jsonb_build_object('error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', v_path);
end;
$$;

create or replace function public.fds_skp_device_publish(
  p_access_token text,
  p_lease_id uuid,
  p_manifest_hash text,
  p_verify_only boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate jsonb;
  v_lease public.fds_skp_job_leases%rowtype;
  v_job public.processing_jobs%rowtype;
  v_required text[] := array['skp', 'fbx', 'fbx_bundle', 'glb', 'preview', 'validation', 'manifest'];
  v_role text;
  v_art public.fds_skp_generation_artifacts%rowtype;
  v_arts jsonb := '{}'::jsonb;
  v_user uuid;
  v_base text;
  v_note text := 'AI 草稿（本機 Codex 依產品資料及圖片建模，未經人工驗收）';
  v_skp_id uuid;
  v_fbx_id uuid;
  v_glb_id uuid;
  v_replaced int := 0;
  v_done boolean;
begin
  v_gate := public.fds_skp_device_gate(p_access_token);
  if coalesce(v_gate ->> 'ok', '') <> 'true' then
    return v_gate;
  end if;
  if p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('error', 'invalid_request');
  end if;
  select * into v_lease from public.fds_skp_job_leases where id = p_lease_id for update;
  if v_lease.id is null or v_lease.device_id is distinct from (v_gate ->> 'device_id')::uuid then
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  select * into v_job from public.processing_jobs where id = v_lease.job_id for update;
  if v_job.job_type <> 'generate_skp' or v_job.payload ->> 'mode' is distinct from 'codex_v1' then
    return jsonb_build_object('error', 'forbidden');
  end if;

  -- Lost response: the same manifest was already published by this lease.
  if v_job.status = 'succeeded' then
    if v_job.result ->> 'manifest_hash' = p_manifest_hash and v_job.result ->> 'lease_id' = v_lease.id::text then
      update public.fds_skp_job_leases set status = 'completed', content_hash = p_manifest_hash
      where id = v_lease.id and status <> 'completed';
      return jsonb_build_object('ok', true, 'idempotent', true, 'models', v_job.result -> 'models');
    end if;
    return jsonb_build_object('error', 'lease_rejected');
  end if;
  if v_lease.status <> 'active' or v_job.attempts <> v_lease.attempt
     or v_job.worker is distinct from v_lease.device_id::text or v_job.status <> 'running' then
    return jsonb_build_object('error', 'lease_rejected');
  end if;

  foreach v_role in array v_required || array['report']
  loop
    select * into v_art from public.fds_skp_generation_artifacts a
    where a.job_id = v_job.id and a.attempt = v_lease.attempt and a.lease_id = v_lease.id and a.role = v_role;
    if v_art.id is null then
      if v_role = any (v_required) then
        return jsonb_build_object('error', 'artifact_missing', 'role', v_role);
      end if;
      continue;
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'product-models' and o.name = v_art.storage_path
        and (o.metadata ->> 'size')::bigint = v_art.size_bytes
    ) then
      return jsonb_build_object('error', 'artifact_missing', 'role', v_role);
    end if;
    v_arts := v_arts || jsonb_build_object(v_role, jsonb_build_object(
      'path', v_art.storage_path, 'size_bytes', v_art.size_bytes, 'sha256', v_art.content_hash));
  end loop;
  if v_arts #>> '{manifest,sha256}' is distinct from p_manifest_hash then
    return jsonb_build_object('error', 'upload_rejected');
  end if;
  if p_verify_only then
    return jsonb_build_object('ok', true, 'verified', true);
  end if;

  v_user := nullif(v_job.payload ->> 'user_id', '')::uuid;
  v_base := left(regexp_replace(coalesce(
      nullif(v_job.payload #>> '{snapshot,product,model}', ''),
      nullif(v_job.payload #>> '{snapshot,product,sku}', ''),
      v_job.payload ->> 'product_id'), '[^A-Za-z0-9_.-]+', '_', 'g'), 80)
    || '-ai-' || to_char(now(), 'YYYYMMDD-HH24MI');

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode,
    preview_status, preview_storage_path, preview_content_hash, preview_updated_at
  ) values (
    v_job.payload ->> 'product_id', 'su', 'skp', 'generated', v_arts #>> '{skp,path}', v_base || '.skp',
    (v_arts #>> '{skp,size_bytes}')::bigint, v_arts #>> '{skp,sha256}',
    v_user, v_note, v_job.id, 'codex_v1',
    'ready', v_arts #>> '{glb,path}', v_arts #>> '{glb,sha256}', now()
  ) returning id into v_skp_id;

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode, bundle_storage_path
  ) values (
    v_job.payload ->> 'product_id', '3d', 'fbx', 'generated', v_arts #>> '{fbx,path}', v_base || '.fbx',
    (v_arts #>> '{fbx,size_bytes}')::bigint, v_arts #>> '{fbx,sha256}',
    v_user, v_note, v_job.id, 'codex_v1', v_arts #>> '{fbx_bundle,path}'
  ) returning id into v_fbx_id;

  insert into public.product_models (
    product_id, model_type, format, source, storage_path, file_name, size_bytes, content_hash,
    created_by, version_note, generation_job_id, generation_mode
  ) values (
    v_job.payload ->> 'product_id', '3d', 'glb', 'generated', v_arts #>> '{glb,path}', v_base || '.glb',
    (v_arts #>> '{glb,size_bytes}')::bigint, v_arts #>> '{glb,sha256}',
    v_user, v_note, v_job.id, 'codex_v1'
  ) returning id into v_glb_id;

  -- Explicit replacement only, after the new set is registered in this same transaction.
  with gone as (
    delete from public.product_models m
    where m.product_id = v_job.payload ->> 'product_id'
      and m.id in (select (value #>> '{}')::uuid from jsonb_array_elements(coalesce(v_job.payload -> 'replace_model_ids', '[]'::jsonb)))
      and m.id not in (v_skp_id, v_fbx_id, v_glb_id)
    returning m.*
  )
  insert into public.fds_product_models_retired (id, product_id, row_data, storage_paths, replaced_by_job_id)
  select g.id, g.product_id, to_jsonb(g),
         array_remove(array[g.storage_path, g.preview_storage_path, g.bundle_storage_path], null),
         v_job.id
  from gone g
  on conflict (id) do nothing;
  get diagnostics v_replaced = row_count;

  v_done := public.fds_processing_job_complete(v_job.id, jsonb_build_object(
    'mode', 'codex_v1',
    'stage', 'done',
    'stage_at', now(),
    'lease_id', v_lease.id,
    'manifest_hash', p_manifest_hash,
    'artifacts', v_arts,
    'replaced', v_replaced,
    'models', jsonb_build_object('skp', v_skp_id, 'fbx', v_fbx_id, 'glb', v_glb_id)
  ));
  if not coalesce(v_done, false) then
    raise exception 'not_completed';
  end if;
  update public.fds_skp_job_leases set status = 'completed', content_hash = p_manifest_hash where id = v_lease.id;
  update public.fds_skp_devices set current_job_id = null, current_lease_id = null, updated_at = now()
  where id = v_lease.device_id;
  perform public.fds_skp_audit('job_publish', 'succeeded', v_lease.device_id, null, v_job.id,
    jsonb_build_object('lease_id', v_lease.id, 'manifest_hash', p_manifest_hash, 'replaced', v_replaced));
  return jsonb_build_object('ok', true, 'models', jsonb_build_object('skp', v_skp_id, 'fbx', v_fbx_id, 'glb', v_glb_id));
end;
$$;

-- ── 產品模型列表帶上 FBX 貼圖包與來源任務 ──────────────────────────────────

create or replace function public.fds_product_models(p_product_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'model_type', m.model_type,
      'format', m.format,
      'source', m.source,
      'storage_path', m.storage_path,
      'file_name', m.file_name,
      'size_bytes', m.size_bytes,
      'version_note', m.version_note,
      'created_at', m.created_at,
      'preview', case when m.format = 'skp' then public.fds_skp_preview_status_for(m.id) else null end,
      'furniture_model_id', m.furniture_model_id,
      'quality_status', f.quality_status,
      'width_mm', f.parametric -> 'width_mm',
      'depth_mm', f.parametric -> 'depth_mm',
      'height_mm', f.parametric -> 'height_mm',
      'bundle_storage_path', m.bundle_storage_path,
      'generation_job_id', m.generation_job_id,
      'generation_mode', m.generation_mode
    ) order by m.model_type, m.created_at desc)
    from public.product_models m
    left join public.furniture_models f on f.id = m.furniture_model_id
    where m.product_id = p_product_id
  ), '[]'::jsonb);
end;
$$;

-- ── 權限 ──────────────────────────────────────────────────────────────────

revoke all on function public.fds_skp_device_has_codex(jsonb) from public, anon, authenticated;
revoke all on function public.fds_skp_codex_worker_available() from public, anon, authenticated;
revoke all on function public.fds_skp_plain_text(text, int) from public, anon, authenticated;
revoke all on function public.fds_skp_reference_images(public.products, jsonb) from public, anon, authenticated;
revoke all on function public.fds_skp_product_snapshot(public.products, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fds_product_skp_job_json(public.processing_jobs) from public, anon, authenticated;
revoke all on function public.fds_skp_device_claim(text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_job_stage(text, uuid, text, numeric, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_artifact_prepare(text, uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.fds_skp_device_artifact_path(text, uuid, text) from public, anon, authenticated;
revoke all on function public.fds_skp_device_publish(text, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fds_skp_device_claim(text) to service_role;
grant execute on function public.fds_skp_device_job_stage(text, uuid, text, numeric, text) to service_role;
grant execute on function public.fds_skp_device_artifact_prepare(text, uuid, text, text, bigint) to service_role;
grant execute on function public.fds_skp_device_artifact_path(text, uuid, text) to service_role;
grant execute on function public.fds_skp_device_publish(text, uuid, text, boolean) to service_role;

revoke all on function public.fds_product_skp_status(text) from public, anon;
revoke all on function public.fds_request_product_skp(text, uuid, jsonb, uuid[]) from public, anon;
revoke all on function public.fds_product_skp_cancel(uuid) from public, anon;
revoke all on function public.fds_skp_preflight(boolean) from public, anon;
grant execute on function public.fds_product_skp_status(text) to authenticated;
grant execute on function public.fds_request_product_skp(text, uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.fds_product_skp_cancel(uuid) to authenticated;
grant execute on function public.fds_skp_preflight(boolean) to authenticated;

notify pgrst, 'reload schema';
