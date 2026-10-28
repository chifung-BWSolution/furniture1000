-- 尺寸驅動傢俬建模（PRD FR-02／FR-03／FR-06／FR-07）。
-- 沿用 furniture_models：每列＝一個不可修改的模型版本，修改一律另存新列（parent_id 指向來源版本）。
-- 尺寸依據、零件、約束都在 parametric JSON（parametric.evidence），本檔只加版本、hash 與驗收欄位。
-- 品質狀態由伺服器按 parametric.evidence 推算，前端不能自稱「待驗收」或「已驗收」。
--   unreviewed      舊資料或沒有尺寸依據 → 顯示「未驗收」，不回填
--   draft           仍有估算／待確認／缺失／衝突的關鍵尺寸 → 草稿，不可驗收通過
--   pending_review  關鍵尺寸全部已確認 → 待驗收
--   accepted／rejected 只經 fds_review_furniture_model（admin／uploader）

alter table public.furniture_models
  add column if not exists parent_id uuid references public.furniture_models(id) on delete set null,
  add column if not exists quality_status text not null default 'unreviewed',
  add column if not exists params_hash text,
  add column if not exists engine_version text,
  add column if not exists review jsonb,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz;

alter table public.furniture_models drop constraint if exists furniture_models_quality_status_check;
alter table public.furniture_models add constraint furniture_models_quality_status_check
  check (quality_status in ('unreviewed', 'draft', 'pending_review', 'accepted', 'rejected'));

create index if not exists furniture_models_product_created_idx
  on public.furniture_models (product_id, created_at desc);
create unique index if not exists furniture_models_product_params_hash
  on public.furniture_models (product_id, params_hash)
  where product_id is not null and params_hash is not null;

create or replace function public.fds_furniture_model_quality(p_parametric jsonb)
returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(jsonb_typeof(p_parametric -> 'evidence' -> 'dimensions'), '') <> 'array'
      or jsonb_array_length(p_parametric -> 'evidence' -> 'dimensions') = 0 then 'unreviewed'
    when exists (
      select 1 from jsonb_array_elements(p_parametric -> 'evidence' -> 'dimensions') d
      where coalesce((d ->> 'critical')::boolean, true)
        and coalesce(d ->> 'status', 'missing') <> 'confirmed'
    ) then 'draft'
    when jsonb_typeof(p_parametric -> 'evidence' -> 'blockers') = 'array'
      and jsonb_array_length(p_parametric -> 'evidence' -> 'blockers') > 0 then 'draft'
    else 'pending_review'
  end
$$;
revoke all on function public.fds_furniture_model_quality(jsonb) from public, anon;
grant execute on function public.fds_furniture_model_quality(jsonb) to authenticated;

drop function if exists public.fds_save_furniture_model(text, jsonb, boolean, text);
create function public.fds_save_furniture_model(
  p_kind text,
  p_parametric jsonb,
  p_estimated boolean default false,
  p_product_id text default null,
  p_parent_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_product text := nullif(btrim(coalesce(p_product_id, '')), '');
  v_parent public.furniture_models%rowtype;
  v_hash text;
begin
  if not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if p_kind not in (
    'desk', 'conference', 'dining', 'coffee', 'bar_counter', 'reception', 'lectern',
    'cabinet', 'pedestal', 'shelf',
    'office_chair', 'side_chair', 'stool', 'beam_seating', 'sofa', 'booth',
    'phone_booth', 'custom'
  ) then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_parametric) <> 'object' then
    raise exception 'parametric_invalid' using errcode = '22023';
  end if;
  -- Hard geometry errors never become a usable model: overall size must be finite and positive.
  if coalesce(jsonb_typeof(p_parametric -> 'width_mm'), '') <> 'number'
    or coalesce(jsonb_typeof(p_parametric -> 'depth_mm'), '') <> 'number'
    or coalesce(jsonb_typeof(p_parametric -> 'height_mm'), '') <> 'number'
    or (p_parametric ->> 'width_mm')::numeric <= 0
    or (p_parametric ->> 'depth_mm')::numeric <= 0
    or (p_parametric ->> 'height_mm')::numeric <= 0
    or coalesce(jsonb_typeof(p_parametric -> 'components'), '') <> 'array'
    or jsonb_array_length(p_parametric -> 'components') = 0 then
    raise exception 'parametric_invalid' using errcode = '22023';
  end if;
  if v_product is not null and not exists (select 1 from public.products p where p.id = v_product) then
    raise exception 'product_not_found' using errcode = 'P0002';
  end if;
  if p_parent_id is not null then
    select * into v_parent from public.furniture_models where id = p_parent_id;
    if v_parent.id is null or v_parent.product_id is distinct from v_product then
      raise exception 'parent_invalid' using errcode = '22023';
    end if;
  end if;

  v_hash := encode(sha256(convert_to(p_parametric::text, 'UTF8')), 'hex');
  -- Same product and identical parameters: the existing version and its files are reused.
  if v_product is not null then
    select id into v_id from public.furniture_models
    where product_id = v_product and params_hash = v_hash;
    if v_id is not null then return v_id; end if;
  end if;

  begin
    insert into public.furniture_models (
      product_id, kind, parametric, estimated, created_by,
      parent_id, quality_status, params_hash, engine_version
    ) values (
      v_product, p_kind, p_parametric, coalesce(p_estimated, false), auth.uid(),
      p_parent_id, public.fds_furniture_model_quality(p_parametric), v_hash,
      left(nullif(p_parametric ->> 'engine_version', ''), 40)
    )
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.furniture_models
    where product_id = v_product and params_hash = v_hash;
    if v_id is null then raise; end if;
  end;
  return v_id;
end;
$$;
revoke all on function public.fds_save_furniture_model(text, jsonb, boolean, text, uuid) from public, anon;
grant execute on function public.fds_save_furniture_model(text, jsonb, boolean, text, uuid) to authenticated;

-- Program checks run in the browser on the same deterministic geometry; the server keeps
-- the result and refuses acceptance unless evidence, checks and the appearance review all pass.
create or replace function public.fds_review_furniture_model(
  p_id uuid,
  p_decision text,
  p_note text default null,
  p_checks jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_checks jsonb := coalesce(p_checks, '{}'::jsonb);
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'decision_invalid' using errcode = '22023';
  end if;
  select * into v_model from public.furniture_models where id = p_id for update;
  if v_model.id is null then raise exception 'model_not_found' using errcode = 'P0002'; end if;
  if v_model.quality_status in ('accepted', 'rejected') then
    raise exception 'review_closed' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_note is null then
    raise exception 'review_note_required' using errcode = '22023';
  end if;
  if p_decision = 'accepted' then
    if v_model.quality_status <> 'pending_review' then
      raise exception 'review_blocked_evidence' using errcode = '22023';
    end if;
    if coalesce(jsonb_typeof(v_checks -> 'errors'), '') <> 'array'
      or jsonb_array_length(v_checks -> 'errors') > 0 then
      raise exception 'review_blocked_checks' using errcode = '22023';
    end if;
    if coalesce((v_checks ->> 'appearance_ok')::boolean, false) is not true then
      raise exception 'review_blocked_appearance' using errcode = '22023';
    end if;
    if (v_checks ->> 'params_hash') is distinct from v_model.params_hash then
      raise exception 'review_stale' using errcode = '22023';
    end if;
  end if;
  update public.furniture_models
  set quality_status = p_decision,
      review = jsonb_build_object(
        'decision', p_decision,
        'note', v_note,
        'checks', v_checks,
        'reviewer_staff_id', public.bwf_current_staff_id()
      ),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('id', p_id, 'quality_status', p_decision);
end;
$$;
revoke all on function public.fds_review_furniture_model(uuid, text, text, jsonb) from public, anon;
grant execute on function public.fds_review_furniture_model(uuid, text, text, jsonb) to authenticated;

-- All versions of one product, newest first; light fields only (no geometry).
create or replace function public.fds_furniture_model_versions(p_product_id text)
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
      'id', f.id,
      'parent_id', f.parent_id,
      'kind', f.kind,
      'width_mm', f.parametric -> 'width_mm',
      'depth_mm', f.parametric -> 'depth_mm',
      'height_mm', f.parametric -> 'height_mm',
      'estimated', f.estimated,
      'quality_status', f.quality_status,
      'engine_version', f.engine_version,
      'params_hash', f.params_hash,
      'review', f.review,
      'reviewed_at', f.reviewed_at,
      'created_at', f.created_at,
      'dimensions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'key', d ->> 'key', 'label', d ->> 'label', 'status', d ->> 'status', 'critical', d -> 'critical'
        )), '[]'::jsonb)
        from jsonb_array_elements(case
          when jsonb_typeof(f.parametric -> 'evidence' -> 'dimensions') = 'array'
          then f.parametric -> 'evidence' -> 'dimensions' else '[]'::jsonb end) d
      ),
      'files', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', m.id, 'format', m.format, 'storage_path', m.storage_path,
          'file_name', m.file_name, 'size_bytes', m.size_bytes
        ) order by m.format), '[]'::jsonb)
        from public.product_models m where m.furniture_model_id = f.id
      ),
      'skp', public.fds_skp_status_for(f.id)
    ) order by f.created_at desc)
    from public.furniture_models f
    where f.product_id = p_product_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.fds_furniture_model_versions(text) from public, anon;
grant execute on function public.fds_furniture_model_versions(text) to authenticated;

create or replace function public.fds_furniture_model_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_model public.furniture_models%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader', 'pm', 'designer']);
  select * into v_model from public.furniture_models where id = p_id;
  if v_model.id is null then raise exception 'model_not_found' using errcode = 'P0002'; end if;
  -- Unlinked drafts stay private to their author, as in fds_list_furniture_models.
  if v_model.product_id is null and v_model.created_by is distinct from auth.uid()
    and not public.bwf_has_role(array['admin', 'uploader']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v_model.id,
    'product_id', v_model.product_id,
    'parent_id', v_model.parent_id,
    'kind', v_model.kind,
    'parametric', v_model.parametric,
    'quality_status', v_model.quality_status,
    'params_hash', v_model.params_hash,
    'engine_version', v_model.engine_version,
    'review', v_model.review,
    'reviewed_at', v_model.reviewed_at,
    'created_at', v_model.created_at
  );
end;
$$;
revoke all on function public.fds_furniture_model_detail(uuid) from public, anon;
grant execute on function public.fds_furniture_model_detail(uuid) to authenticated;

-- Existing file list, plus the version and acceptance state of generated files.
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
      'height_mm', f.parametric -> 'height_mm'
    ) order by m.model_type, m.created_at desc)
    from public.product_models m
    left join public.furniture_models f on f.id = m.furniture_model_id
    where m.product_id = p_product_id
  ), '[]'::jsonb);
end;
$$;

notify pgrst, 'reload schema';
