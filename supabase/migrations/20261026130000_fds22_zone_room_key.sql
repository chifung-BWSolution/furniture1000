-- FDS-10：分區改名稱與代號後，房間清單同步不應把名稱改回去。
--
-- 現況：project_zones 沒有記住自己對應哪個房間種類（roomKey），
-- syncProjectZones 只能靠名稱比對，所以手動改名後再按「儲存」會被還原。
--
-- 解法：記住 room_key。同步時以 room_key + 同種類序號比對，
-- 名稱只是顯示值，改名不再影響對應關係。
--
-- 不新增另一套區域模型：仍然寫入現有 project_zones（見 FDS-V2.2 §13）。
-- 舊資料不回填：room_key 的對應關係由前端讀取分區時按名稱補一次，
-- SQL 端沒有房間種類清單，強行回填反而會對錯。

alter table public.project_zones
  add column if not exists room_key text;

comment on column public.project_zones.room_key is
  '對應房間種類 key（projectPartitionTemplates）。FDS-10 分區改名／改代號後仍以它比對同步。';

create index if not exists idx_project_zones_project_room_key
  on public.project_zones (project_id, room_key)
  where room_key is not null;

notify pgrst, 'reload schema';
