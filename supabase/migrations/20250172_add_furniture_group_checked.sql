-- Add furniture_group_checked to ready_to_shopify
-- null / true  → visible in 準備上載
-- false        → visible in 傢俬組檢查 (not yet cleared for upload)
alter table public.ready_to_shopify
  add column if not exists furniture_group_checked boolean default null;
