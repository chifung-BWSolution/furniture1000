-- 報價設定 › 圖片庫：封面／封底頁（參考 FCCD 的 quote_pdf_pages）
--   一張圖除了可以插進報價內頁，也可以設定成 PDF 的封面（第 1 頁起）或封底（最後一頁）。
--   封面／封底頁每次出 PDF 自動插入，不需要逐張報價挑選；停用的不會插入。

alter table public.quote_photo_assets
  add column if not exists placement text not null default 'content',
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quote_photo_assets_placement_check'
  ) then
    alter table public.quote_photo_assets
      add constraint quote_photo_assets_placement_check
      check (placement in ('content', 'cover', 'back'));
  end if;
end
$$;

create index if not exists quote_photo_assets_placement_idx
  on public.quote_photo_assets (placement, is_active, sort_order);

comment on column public.quote_photo_assets.placement is
  'content＝報價內頁排版用；cover＝PDF 封面（第 1 頁起）；back＝PDF 封底（最後一頁）';
comment on column public.quote_photo_assets.is_active is
  '封面／封底停用後不會插入新的報價 PDF';
