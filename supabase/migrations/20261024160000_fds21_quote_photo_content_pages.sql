-- 報價設定 › 圖片庫：內頁圖指定插在正文第幾頁之後
--   內頁（content）圖除了照報價排版印在總價之後，也可以設定為
--   「獨立整頁」：出 PDF 時自動插在正文第 page_number 頁之後，
--   佔一整頁 A4（照封面／封底的做法）。is_active = false 時不自動插入。

alter table public.quote_photo_assets
  add column if not exists page_number integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quote_photo_assets_page_number_check'
  ) then
    alter table public.quote_photo_assets
      add constraint quote_photo_assets_page_number_check
      check (page_number >= 1);
  end if;
end
$$;

comment on column public.quote_photo_assets.page_number is
  'placement=content 且啟用時：出 PDF 自動插在正文第 page_number 頁之後的獨立整頁；超出正文頁數時排在正文最後一頁之後';
