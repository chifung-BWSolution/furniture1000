-- 報價設定 › 圖片庫：AI 生成參考圖標記
--   AI 生成的圖（Grok / Gemini）要在圖片庫、素材區與報價 PDF 都標示
--   「AI 生成示意圖，僅供設計參考」，避免當成現場實拍。

alter table public.quote_photo_assets
  add column if not exists is_generated boolean not null default false;

comment on column public.quote_photo_assets.is_generated is
  'true＝由 AI（Grok / Gemini）生成的參考圖，介面與 PDF 都會加註示意圖標示';
