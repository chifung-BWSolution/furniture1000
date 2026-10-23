-- 報價設定 › 圖片庫（參考 QMS 的 qms_quote_photo_assets）
--   全公司共用一個圖片庫；一張報價只記錄選了哪些圖（存在 bwf_quote.project_data.quotePhotos）。
--   圖片存公開 bucket quote-photos，跟產品圖同一種取法（Storage HTTP URL，不入 DB base64）。
--   上載／排序／刪除都經前端直接寫 Storage + 這張表，權限靠 RLS。

create table if not exists public.quote_photo_assets (
  id uuid primary key default gen_random_uuid(),
  title text not null default '圖片',
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  sort_order integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quote_photo_assets_order_idx
  on public.quote_photo_assets (sort_order, created_at);

alter table public.quote_photo_assets enable row level security;
revoke all on table public.quote_photo_assets from public, anon, authenticated;
grant select, insert, update, delete on table public.quote_photo_assets to authenticated;

drop policy if exists "quote_photo_assets_select" on public.quote_photo_assets;
create policy "quote_photo_assets_select"
  on public.quote_photo_assets
  for select
  to authenticated
  using (
    public.bwf_has_role(array['admin', 'uploader', 'pm', 'designer', 'staff'])
  );

drop policy if exists "quote_photo_assets_insert" on public.quote_photo_assets;
create policy "quote_photo_assets_insert"
  on public.quote_photo_assets
  for insert
  to authenticated
  with check (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists "quote_photo_assets_update" on public.quote_photo_assets;
create policy "quote_photo_assets_update"
  on public.quote_photo_assets
  for update
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']))
  with check (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists "quote_photo_assets_delete" on public.quote_photo_assets;
create policy "quote_photo_assets_delete"
  on public.quote_photo_assets
  for delete
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

create or replace function public.quote_photo_assets_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.quote_photo_assets_touch() from public, anon, authenticated;

drop trigger if exists quote_photo_assets_touch on public.quote_photo_assets;
create trigger quote_photo_assets_touch
  before update on public.quote_photo_assets
  for each row
  execute function public.quote_photo_assets_touch();

-- ── Storage：報價單圖片庫 ────────────────────────────────────────────
-- 公開讀取（報價單 PDF 要直接抓圖），寫入只限 admin / uploader。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'quote-photos',
  'quote-photos',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "quote_photos_objects_insert" on storage.objects;
create policy "quote_photos_objects_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'quote-photos'
    and name like 'library/%'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

drop policy if exists "quote_photos_objects_delete" on storage.objects;
create policy "quote_photos_objects_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'quote-photos'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

drop policy if exists "quote_photos_objects_read" on storage.objects;
create policy "quote_photos_objects_read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'quote-photos');
