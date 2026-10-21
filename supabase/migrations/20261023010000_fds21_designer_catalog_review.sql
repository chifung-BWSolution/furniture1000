-- Designer catalogue uploads stay out of the product library until an admin approves them.
-- The uploader, factory, source PDF and time live on the batch. Rejected rows are kept with a reason.
-- Writes go through SECURITY DEFINER RPCs. RLS only grants SELECT to the uploader or an admin.

create table if not exists public.designer_catalog_batches (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null,
  uploader_email text,
  uploader_name text,
  factory_id text,
  factory_name text not null,
  storage_path text not null,
  file_name text not null,
  file_size bigint check (file_size is null or file_size >= 0),
  content_hash text,
  status text not null default 'parsing'
    check (status in ('parsing', 'pending', 'partial', 'approved', 'rejected', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists designer_catalog_batches_uploader_idx
  on public.designer_catalog_batches (uploader_id, created_at desc);
create index if not exists designer_catalog_batches_status_idx
  on public.designer_catalog_batches (status, created_at desc);

create table if not exists public.designer_catalog_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.designer_catalog_batches (id) on delete cascade,
  seq int not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  title text not null,
  description text not null default '',
  model_number text not null default '',
  material text not null default '',
  color text not null default '',
  dimensions_text text not null default '',
  width_mm numeric check (width_mm is null or width_mm >= 0),
  depth_mm numeric check (depth_mm is null or depth_mm >= 0),
  height_mm numeric check (height_mm is null or height_mm >= 0),
  price numeric check (price is null or price >= 0),
  currency text,
  image_url text,
  page_no int check (page_no is null or page_no >= 1),
  level1_category text,
  level2_category text,
  product_category_id uuid references public.product_category (id) on delete set null,
  tags text[] not null default '{}',
  raw_json jsonb not null default '{}'::jsonb,
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_product_id text references public.products (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists designer_catalog_items_batch_idx
  on public.designer_catalog_items (batch_id, seq);
create index if not exists designer_catalog_items_status_idx
  on public.designer_catalog_items (status, batch_id);

create or replace function public.fds_designer_catalog_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_designer_catalog_batches_touch on public.designer_catalog_batches;
create trigger trg_designer_catalog_batches_touch
  before update on public.designer_catalog_batches
  for each row execute function public.fds_designer_catalog_touch();

drop trigger if exists trg_designer_catalog_items_touch on public.designer_catalog_items;
create trigger trg_designer_catalog_items_touch
  before update on public.designer_catalog_items
  for each row execute function public.fds_designer_catalog_touch();

alter table public.designer_catalog_batches enable row level security;
alter table public.designer_catalog_items enable row level security;

drop policy if exists designer_catalog_batches_select on public.designer_catalog_batches;
create policy designer_catalog_batches_select
  on public.designer_catalog_batches
  for select
  to authenticated
  using (
    uploader_id = auth.uid()
    or public.bwf_has_role(array['admin'])
  );

drop policy if exists designer_catalog_items_select on public.designer_catalog_items;
create policy designer_catalog_items_select
  on public.designer_catalog_items
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin'])
    or exists (
      select 1
      from public.designer_catalog_batches b
      where b.id = batch_id
        and b.uploader_id = auth.uid()
    )
  );

revoke all on table public.designer_catalog_batches from public, anon, authenticated;
revoke all on table public.designer_catalog_items from public, anon, authenticated;
grant select on table public.designer_catalog_batches to authenticated;
grant select on table public.designer_catalog_items to authenticated;

revoke all on function public.fds_designer_catalog_touch() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('designer-catalog-pdfs', 'designer-catalog-pdfs', false, 209715200, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "designer_catalog_pdf_insert" on storage.objects;
create policy "designer_catalog_pdf_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'designer-catalog-pdfs'
    and public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer'])
    and (storage.foldername(name))[1] = auth.uid()::text
    and right(lower(name), 4) = '.pdf'
  );

drop policy if exists "designer_catalog_pdf_select" on storage.objects;
create policy "designer_catalog_pdf_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'designer-catalog-pdfs'
    and (
      public.bwf_has_role(array['admin'])
      or (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- ── helpers ───────────────────────────────────────────────────────────

create or replace function public.fds_designer_catalog_resolve_category(p_id uuid)
returns table (id uuid, level1 text, level2 text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, btrim(c.level1), btrim(c.level2)
  from public.product_category c
  where c.id = p_id;
$$;

create or replace function public.fds_designer_catalog_refresh_batch(p_batch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_pending int;
  v_approved int;
  v_rejected int;
  v_total int;
  v_status text;
begin
  select b.uploader_id into v_owner
  from public.designer_catalog_batches b
  where b.id = p_batch_id;
  if v_owner is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  if v_owner is distinct from auth.uid() and not public.bwf_has_role(array['admin']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'approved'),
    count(*) filter (where status = 'rejected'),
    count(*)
  into v_pending, v_approved, v_rejected, v_total
  from public.designer_catalog_items
  where batch_id = p_batch_id;

  v_status := case
    when v_total = 0 then 'failed'
    when v_pending > 0 then 'pending'
    when v_approved = v_total then 'approved'
    when v_rejected = v_total then 'rejected'
    else 'partial'
  end;

  update public.designer_catalog_batches
  set status = v_status,
      error_message = case when v_status = 'failed' then coalesce(error_message, '沒有解析到產品') else null end
  where id = p_batch_id
    and status is distinct from 'parsing';
end;
$$;

-- ── designer upload ───────────────────────────────────────────────────

create or replace function public.fds_designer_catalog_batch_create(
  p_storage_path text,
  p_factory_id text,
  p_factory_name text,
  p_file_name text,
  p_file_size bigint,
  p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_email text;
  v_size bigint;
  v_factory text;
begin
  if auth.uid() is null or not public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer']) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  v_factory := btrim(coalesce(p_factory_name, ''));
  if v_factory = '' then
    raise exception 'factory_required' using errcode = '22023';
  end if;
  if split_part(coalesce(p_storage_path, ''), '/', 1) is distinct from auth.uid()::text
     or coalesce(p_storage_path, '') !~ '^[0-9a-f-]{36}/[0-9a-f]{64}\.pdf$'
  then
    raise exception 'storage_path_invalid' using errcode = '22023';
  end if;

  select nullif(o.metadata ->> 'size', '')::bigint
    into v_size
  from storage.objects o
  where o.bucket_id = 'designer-catalog-pdfs'
    and o.name = p_storage_path;
  if v_size is null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'designer-catalog-pdfs' and o.name = p_storage_path
  ) then
    raise exception 'storage_object_missing' using errcode = 'P0002';
  end if;
  if coalesce(v_size, p_file_size, 0) > 209715200 then
    raise exception 'file_too_large' using errcode = '22023';
  end if;

  v_email := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  select p.display_name into v_name
  from public.platform_user_profiles p
  where p.active is true
    and (p.auth_user_id = auth.uid() or lower(p.email) = v_email)
  order by (p.auth_user_id = auth.uid()) desc nulls last
  limit 1;

  insert into public.designer_catalog_batches (
    uploader_id, uploader_email, uploader_name, factory_id, factory_name,
    storage_path, file_name, file_size, content_hash, status
  ) values (
    auth.uid(),
    v_email,
    nullif(btrim(coalesce(v_name, '')), ''),
    nullif(btrim(coalesce(p_factory_id, '')), ''),
    left(v_factory, 200),
    p_storage_path,
    left(coalesce(nullif(btrim(p_file_name), ''), 'catalog.pdf'), 240),
    coalesce(v_size, p_file_size),
    nullif(lower(btrim(coalesce(p_content_hash, ''))), ''),
    'parsing'
  )
  returning id into v_id;

  return jsonb_build_object('batchId', v_id);
end;
$$;

create or replace function public.fds_designer_catalog_batch_fail(
  p_batch_id uuid,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  select uploader_id, status into v_owner, v_status
  from public.designer_catalog_batches
  where id = p_batch_id
  for update;
  if v_owner is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if v_status <> 'parsing' then
    return;
  end if;
  update public.designer_catalog_batches
  set status = 'failed',
      error_message = left(coalesce(nullif(btrim(p_message), ''), '解析失敗'), 500)
  where id = p_batch_id;
end;
$$;

create or replace function public.fds_designer_catalog_items_submit(
  p_batch_id uuid,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_status text;
  v_row jsonb;
  v_seq int := 0;
  v_count int := 0;
  v_cat_id uuid;
  v_level1 text;
  v_level2 text;
  v_title text;
  v_image text;
  v_tags text[];
  v_page numeric;
  v_width numeric;
  v_depth numeric;
  v_height numeric;
  v_price numeric;
begin
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 400 then
    raise exception 'items_invalid' using errcode = '22023';
  end if;

  select uploader_id, status into v_owner, v_status
  from public.designer_catalog_batches
  where id = p_batch_id
  for update;
  if v_owner is null then
    raise exception 'batch_not_found' using errcode = 'P0002';
  end if;
  if v_owner is distinct from auth.uid() or v_status <> 'parsing' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if exists (select 1 from public.designer_catalog_items where batch_id = p_batch_id) then
    raise exception 'batch_already_submitted' using errcode = '23505';
  end if;

  for v_row in select value from jsonb_array_elements(p_items) loop
    v_seq := v_seq + 1;
    v_title := left(coalesce(nullif(btrim(v_row ->> 'title'), ''), '未命名產品'), 500);
    v_image := nullif(btrim(coalesce(v_row ->> 'image_url', '')), '');
    if v_image is null or v_image !~ '^https://' then
      v_image := null;
    end if;

    select coalesce(array_agg(left(btrim(t.tag), 40)), '{}')
      into v_tags
    from (
      select tag
      from jsonb_array_elements_text(
        case when jsonb_typeof(v_row -> 'tags') = 'array' then v_row -> 'tags' else '[]'::jsonb end
      ) as t(tag)
      where btrim(tag) <> ''
      limit 20
    ) t;

    v_cat_id := null;
    v_level1 := null;
    v_level2 := null;
    if nullif(btrim(coalesce(v_row ->> 'product_category_id', '')), '') is not null then
      select c.id, c.level1, c.level2
        into v_cat_id, v_level1, v_level2
      from public.fds_designer_catalog_resolve_category((v_row ->> 'product_category_id')::uuid) c;
    end if;

    v_width := public.fds_try_numeric(v_row ->> 'width_mm');
    v_depth := public.fds_try_numeric(v_row ->> 'depth_mm');
    v_height := public.fds_try_numeric(v_row ->> 'height_mm');
    v_price := public.fds_try_numeric(v_row ->> 'price');
    v_page := public.fds_try_numeric(v_row ->> 'page_no');

    insert into public.designer_catalog_items (
      batch_id, seq, status, title, description, model_number, material, color,
      dimensions_text, width_mm, depth_mm, height_mm, price, currency, image_url,
      page_no, level1_category, level2_category, product_category_id, tags, raw_json
    ) values (
      p_batch_id,
      v_seq,
      'pending',
      v_title,
      left(coalesce(v_row ->> 'description', ''), 8000),
      left(coalesce(v_row ->> 'model_number', ''), 120),
      left(coalesce(v_row ->> 'material', ''), 240),
      left(coalesce(v_row ->> 'color', ''), 120),
      left(coalesce(v_row ->> 'dimensions_text', ''), 240),
      case when v_width >= 0 then v_width else null end,
      case when v_depth >= 0 then v_depth else null end,
      case when v_height >= 0 then v_height else null end,
      case when v_price >= 0 then least(v_price, 99999999.99) else null end,
      nullif(left(upper(btrim(coalesce(v_row ->> 'currency', ''))), 8), ''),
      v_image,
      case when v_page >= 1 then v_page::int else null end,
      v_level1,
      nullif(v_level2, ''),
      v_cat_id,
      coalesce(v_tags, '{}'),
      jsonb_strip_nulls(v_row)
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    update public.designer_catalog_batches
    set status = 'failed', error_message = '沒有解析到產品'
    where id = p_batch_id;
  else
    update public.designer_catalog_batches
    set status = 'pending', error_message = null
    where id = p_batch_id;
  end if;

  return jsonb_build_object('inserted', v_count);
exception
  when invalid_text_representation then
    raise exception 'items_invalid' using errcode = '22023';
end;
$$;

-- ── admin review ──────────────────────────────────────────────────────

create or replace function public.fds_designer_catalog_item_update(
  p_item_id uuid,
  p_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.designer_catalog_items%rowtype;
  v_cat_id uuid;
  v_level1 text;
  v_level2 text;
  v_image text;
  v_set_cat boolean := false;
begin
  perform public.bwf_assert_role(array['admin']);
  if jsonb_typeof(p_fields) is distinct from 'object' then
    raise exception 'fields_invalid' using errcode = '22023';
  end if;

  select * into v_item
  from public.designer_catalog_items
  where id = p_item_id
  for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'item_not_pending' using errcode = '22023';
  end if;

  if p_fields ? 'product_category_id' then
    v_set_cat := true;
    if nullif(btrim(coalesce(p_fields ->> 'product_category_id', '')), '') is null then
      v_cat_id := null;
      v_level1 := null;
      v_level2 := null;
    else
      select c.id, c.level1, c.level2
        into v_cat_id, v_level1, v_level2
      from public.fds_designer_catalog_resolve_category((p_fields ->> 'product_category_id')::uuid) c;
      if v_cat_id is null then
        raise exception 'category_unknown' using errcode = '22023';
      end if;
    end if;
  end if;

  v_image := v_item.image_url;
  if p_fields ? 'image_url' then
    v_image := nullif(btrim(coalesce(p_fields ->> 'image_url', '')), '');
    if v_image is not null and v_image !~ '^https://' then
      raise exception 'image_url_invalid' using errcode = '22023';
    end if;
  end if;

  update public.designer_catalog_items
  set
    title = case when p_fields ? 'title' then left(coalesce(nullif(btrim(p_fields ->> 'title'), ''), title), 500) else title end,
    description = case when p_fields ? 'description' then left(coalesce(p_fields ->> 'description', ''), 8000) else description end,
    model_number = case when p_fields ? 'model_number' then left(coalesce(p_fields ->> 'model_number', ''), 120) else model_number end,
    material = case when p_fields ? 'material' then left(coalesce(p_fields ->> 'material', ''), 240) else material end,
    color = case when p_fields ? 'color' then left(coalesce(p_fields ->> 'color', ''), 120) else color end,
    dimensions_text = case when p_fields ? 'dimensions_text' then left(coalesce(p_fields ->> 'dimensions_text', ''), 240) else dimensions_text end,
    width_mm = case when p_fields ? 'width_mm' then public.fds_try_numeric(p_fields ->> 'width_mm') else width_mm end,
    depth_mm = case when p_fields ? 'depth_mm' then public.fds_try_numeric(p_fields ->> 'depth_mm') else depth_mm end,
    height_mm = case when p_fields ? 'height_mm' then public.fds_try_numeric(p_fields ->> 'height_mm') else height_mm end,
    price = case when p_fields ? 'price' then public.fds_try_numeric(p_fields ->> 'price') else price end,
    currency = case when p_fields ? 'currency' then nullif(left(upper(btrim(coalesce(p_fields ->> 'currency', ''))), 8), '') else currency end,
    image_url = v_image,
    level1_category = case when v_set_cat then v_level1 else level1_category end,
    level2_category = case when v_set_cat then nullif(v_level2, '') else level2_category end,
    product_category_id = case when v_set_cat then v_cat_id else product_category_id end
  where id = p_item_id;
exception
  when invalid_text_representation then
    raise exception 'fields_invalid' using errcode = '22023';
end;
$$;

create or replace function public.fds_designer_catalog_items_set_category(
  p_item_ids uuid[],
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cat_id uuid;
  v_level1 text;
  v_level2 text;
  v_updated int;
begin
  perform public.bwf_assert_role(array['admin']);
  select c.id, c.level1, c.level2
    into v_cat_id, v_level1, v_level2
  from public.fds_designer_catalog_resolve_category(p_category_id) c;
  if v_cat_id is null then
    raise exception 'category_unknown' using errcode = '22023';
  end if;

  update public.designer_catalog_items
  set level1_category = v_level1,
      level2_category = nullif(v_level2, ''),
      product_category_id = v_cat_id
  where id = any (p_item_ids)
    and status = 'pending';
  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated);
end;
$$;

create or replace function public.fds_designer_catalog_items_decide(
  p_item_ids uuid[],
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.designer_catalog_items%rowtype;
  v_staff uuid;
  v_product_id text;
  v_approved int := 0;
  v_rejected int := 0;
  v_blocked int := 0;
  v_reason text;
  v_images jsonb;
  v_refresh uuid;
begin
  perform public.bwf_assert_role(array['admin']);
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision_invalid' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if p_decision = 'reject' and v_reason is null then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  v_staff := public.bwf_current_staff_id();

  for v_item in
    select *
    from public.designer_catalog_items
    where id = any (p_item_ids)
    order by seq
    for update
  loop
    if v_item.status <> 'pending' then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    if p_decision = 'reject' then
      update public.designer_catalog_items
      set status = 'rejected',
          rejection_reason = left(v_reason, 500),
          reviewed_by = auth.uid(),
          reviewed_at = now()
      where id = v_item.id;
      v_rejected := v_rejected + 1;
      continue;
    end if;

    if v_item.product_category_id is null then
      v_blocked := v_blocked + 1;
      continue;
    end if;

    v_product_id := substr(replace(gen_random_uuid()::text, '-', ''), 1, 13);
    v_images := case
      when v_item.image_url is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('src', v_item.image_url, 'position', 1, 'alt', v_item.title))
    end;

    insert into public.products (
      id, title, description, description_html, tags, price, collection, status,
      image_url, images, sku, model, source, in_catalog,
      factories_display_name, factory_id, material, color, category,
      level1_category, level2_category, product_category_id,
      dimension_l_mm, dimension_w_mm, dimension_h_mm, specifications,
      created_at, created_date, modified_date, creator_staff_id, editor_staff_id
    ) values (
      v_product_id,
      v_item.title,
      coalesce(v_item.description, ''),
      coalesce(v_item.description, ''),
      coalesce(v_item.tags, '{}'),
      least(coalesce(v_item.price, 0), 99999999.99),
      '',
      'draft',
      coalesce(v_item.image_url, ''),
      v_images,
      coalesce(v_item.model_number, ''),
      nullif(v_item.model_number, ''),
      'local',
      true,
      (select b.factory_name from public.designer_catalog_batches b where b.id = v_item.batch_id),
      coalesce((select b.factory_id from public.designer_catalog_batches b where b.id = v_item.batch_id), ''),
      coalesce(v_item.material, ''),
      coalesce(v_item.color, ''),
      coalesce(nullif(v_item.level2_category, ''), v_item.level1_category, ''),
      v_item.level1_category,
      v_item.level2_category,
      v_item.product_category_id,
      v_item.width_mm,
      v_item.depth_mm,
      v_item.height_mm,
      nullif(v_item.dimensions_text, ''),
      now(), now(), now(), v_staff, v_staff
    );

    if v_item.price is not null then
      insert into public.supplier_prices (
        product_id, factory_id, factory_name, page_no, currency, cost_price, verified, raw_ref, creator_staff_id
      )
      select
        v_product_id,
        nullif(b.factory_id, ''),
        b.factory_name,
        v_item.page_no,
        v_item.currency,
        least(v_item.price, 99999999.99),
        true,
        jsonb_build_object('designer_catalog_batch_id', b.id, 'designer_catalog_item_id', v_item.id),
        v_staff
      from public.designer_catalog_batches b
      where b.id = v_item.batch_id;
    end if;

    update public.designer_catalog_items
    set status = 'approved',
        rejection_reason = null,
        approved_product_id = v_product_id,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = v_item.id;
    v_approved := v_approved + 1;
  end loop;

  for v_refresh in
    select distinct i.batch_id
    from public.designer_catalog_items i
    where i.id = any (p_item_ids)
  loop
    perform public.fds_designer_catalog_refresh_batch(v_refresh);
  end loop;

  return jsonb_build_object('approved', v_approved, 'rejected', v_rejected, 'blocked', v_blocked);
end;
$$;

revoke all on function public.fds_designer_catalog_resolve_category(uuid) from public, anon, authenticated;
revoke all on function public.fds_designer_catalog_refresh_batch(uuid) from public, anon, authenticated;
revoke all on function public.fds_designer_catalog_batch_create(text, text, text, text, bigint, text) from public, anon;
revoke all on function public.fds_designer_catalog_batch_fail(uuid, text) from public, anon;
revoke all on function public.fds_designer_catalog_items_submit(uuid, jsonb) from public, anon;
revoke all on function public.fds_designer_catalog_item_update(uuid, jsonb) from public, anon;
revoke all on function public.fds_designer_catalog_items_set_category(uuid[], uuid) from public, anon;
revoke all on function public.fds_designer_catalog_items_decide(uuid[], text, text) from public, anon;

grant execute on function public.fds_designer_catalog_batch_create(text, text, text, text, bigint, text) to authenticated;
grant execute on function public.fds_designer_catalog_batch_fail(uuid, text) to authenticated;
grant execute on function public.fds_designer_catalog_items_submit(uuid, jsonb) to authenticated;
grant execute on function public.fds_designer_catalog_item_update(uuid, jsonb) to authenticated;
grant execute on function public.fds_designer_catalog_items_set_category(uuid[], uuid) to authenticated;
grant execute on function public.fds_designer_catalog_items_decide(uuid[], text, text) to authenticated;

comment on table public.designer_catalog_batches is
  'Designer PDF catalogue upload. Products stay here until an admin approves them into products.';
comment on table public.designer_catalog_items is
  'One parsed product from a designer catalogue. status pending/approved/rejected. Rejection keeps the row and reason.';
