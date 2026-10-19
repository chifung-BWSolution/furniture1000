-- FDS 2.1 Day 3（T-301～T-305）：AI 結構化結果暫存、文件圖片、審核、報價與溯源表。
-- extraction_items.raw_json = AI 原值（不改）；corrected_json = 人工修正。未審核不得成為正式價（BR-02）。
-- supplier_prices / product_source_refs 由 Day 4 的匯入 RPC 寫入；成本只給 admin / uploader（C-04）。

create table if not exists public.supplier_document_images (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.supplier_documents(id) on delete cascade,
  page_no int not null check (page_no >= 1),
  storage_path text not null,
  public_url text not null,
  width int,
  height int,
  byte_size int,
  content_hash text not null,
  page_occurrences int not null default 1,
  image_type text not null default 'other'
    check (image_type in ('main', 'detail', 'dimension', 'fabric', 'logo', 'other')),
  created_at timestamptz not null default now(),
  unique (document_id, content_hash)
);

create index if not exists supplier_document_images_page_idx
  on public.supplier_document_images (document_id, page_no);

create table if not exists public.extraction_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.processing_jobs(id) on delete set null,
  document_id uuid not null references public.supplier_documents(id) on delete cascade,
  segment_id uuid references public.supplier_document_segments(id) on delete set null,
  seq int not null default 0,
  page_no int,
  page_end int,
  bbox jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  corrected_json jsonb,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  flags text[] not null default '{}',
  needs_attention boolean not null default false,
  main_image_id uuid references public.supplier_document_images(id) on delete set null,
  image_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  imported_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint extraction_items_note_len check (review_note is null or char_length(review_note) <= 1000)
);

create index if not exists extraction_items_document_idx
  on public.extraction_items (document_id, status, needs_attention desc, seq);
create index if not exists extraction_items_queue_idx
  on public.extraction_items (status, needs_attention desc, created_at)
  where status = 'pending';

-- F-AI-003：同一產品可有多供應商、多時間的報價（append-only，BR-01）。
create table if not exists public.supplier_prices (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  factory_id text,
  factory_name text,
  document_id uuid references public.supplier_documents(id) on delete set null,
  extraction_item_id uuid references public.extraction_items(id) on delete set null,
  page_no int,
  variant_label text,
  currency text,
  unit text,
  moq numeric check (moq is null or moq >= 0),
  cost_price numeric check (cost_price is null or cost_price >= 0),
  valid_from date,
  valid_to date,
  verified boolean not null default false,
  raw_ref jsonb,
  creator_staff_id uuid,
  created_date timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists supplier_prices_product_idx
  on public.supplier_prices (product_id, created_at desc);
create index if not exists supplier_prices_factory_idx
  on public.supplier_prices (factory_id, created_at desc);

create table if not exists public.product_source_refs (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products(id) on delete cascade,
  document_id uuid not null references public.supplier_documents(id) on delete cascade,
  extraction_item_id uuid references public.extraction_items(id) on delete set null,
  page_no int,
  bbox jsonb,
  created_at timestamptz not null default now(),
  unique (product_id, document_id, page_no)
);

-- ── RLS：只給 admin / uploader 讀，寫入經 RPC 或 service role ─────────────

do $$
declare
  t text;
begin
  foreach t in array array['supplier_document_images', 'extraction_items', 'supplier_prices', 'product_source_refs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_admin_uploader', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.bwf_has_role(array[''admin'', ''uploader'']))',
      t || '_read_admin_uploader', t
    );
  end loop;
end $$;

-- ── 審核 RPC ──────────────────────────────────────────────────────────

create or replace function public.fds_extraction_item_review(
  p_item_id uuid,
  p_status text,
  p_corrected jsonb default null,
  p_main_image_id uuid default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.extraction_items%rowtype;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);

  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;
  if p_corrected is not null and jsonb_typeof(p_corrected) <> 'object' then
    raise exception 'corrected_json_invalid' using errcode = '22023';
  end if;

  select * into v_item from public.extraction_items where id = p_item_id for update;
  if v_item.id is null then
    raise exception 'item_not_found' using errcode = 'P0002';
  end if;
  if v_item.imported_product_id is not null then
    raise exception 'item_already_imported' using errcode = '22023';
  end if;
  if p_main_image_id is not null and not (p_main_image_id = any (v_item.image_ids)) then
    raise exception 'image_not_linked' using errcode = '22023';
  end if;

  update public.extraction_items
  set status = p_status,
      corrected_json = coalesce(p_corrected, corrected_json),
      main_image_id = coalesce(p_main_image_id, main_image_id),
      review_note = case when p_note is null then review_note else nullif(left(btrim(p_note), 1000), '') end,
      reviewed_by = case when p_status = 'pending' then null else public.bwf_current_staff_id() end,
      reviewed_at = case when p_status = 'pending' then null else now() end,
      updated_at = now()
  where id = p_item_id
  returning * into v_item;

  return jsonb_build_object('id', v_item.id, 'status', v_item.status);
end;
$$;

create or replace function public.fds_extraction_items_review_batch(
  p_item_ids uuid[],
  p_status text
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;

  update public.extraction_items
  set status = p_status,
      reviewed_by = case when p_status = 'pending' then null else public.bwf_current_staff_id() end,
      reviewed_at = case when p_status = 'pending' then null else now() end,
      updated_at = now()
  where id = any (p_item_ids)
    and imported_product_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.fds_extraction_item_review(uuid, text, jsonb, uuid, text) from public, anon;
revoke all on function public.fds_extraction_items_review_batch(uuid[], text) from public, anon;
grant execute on function public.fds_extraction_item_review(uuid, text, jsonb, uuid, text) to authenticated;
grant execute on function public.fds_extraction_items_review_batch(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
