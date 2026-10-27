-- FDS 2.2：套餐 Quick Pricing，只用 2026 工作表。
-- 小計 = 數量 × 平均價。標準價錢、高品質價錢是區間文字，不乘進總額。
-- 2026 這一頁沒有運輸或安裝加成。已存報價用 snapshot，改基準價不改舊單。

create table if not exists public.fds_package_price_lines (
  id uuid primary key default gen_random_uuid(),
  sort_order integer not null,
  area text not null,
  item_name text not null default '',
  grade text not null default '',
  material text not null default '',
  dimension_text text not null default '',
  unit_text text not null default '',
  unit_price numeric(14,2),
  standard_note text not null default '',
  premium_note text not null default '',
  default_quantity numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.fds_package_quotes (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  snapshot jsonb not null,
  share_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fds_package_quotes_title_len check (char_length(title) <= 200)
);

alter table public.fds_package_price_lines enable row level security;
alter table public.fds_package_quotes enable row level security;

revoke all on table public.fds_package_price_lines from public, anon, authenticated;
revoke all on table public.fds_package_quotes from public, anon, authenticated;

grant select, update on table public.fds_package_price_lines to authenticated;
grant select, insert, update, delete on table public.fds_package_quotes to authenticated;

drop policy if exists "fds_package_price_lines_select" on public.fds_package_price_lines;
create policy "fds_package_price_lines_select"
  on public.fds_package_price_lines
  for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

drop policy if exists "fds_package_price_lines_update" on public.fds_package_price_lines;
create policy "fds_package_price_lines_update"
  on public.fds_package_price_lines
  for update to authenticated
  using (public.bwf_has_role(array['admin']))
  with check (public.bwf_has_role(array['admin']));

drop policy if exists "fds_package_quotes_all" on public.fds_package_quotes;
create policy "fds_package_quotes_all"
  on public.fds_package_quotes
  for all to authenticated
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));

create or replace function public.fds_package_quote_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select q.snapshot
  from public.fds_package_quotes q
  where q.share_token = p_token
    and p_token is not null
    and char_length(p_token) >= 16
  limit 1
$$;

revoke all on function public.fds_package_quote_by_token(text) from public;
grant execute on function public.fds_package_quote_by_token(text) to anon, authenticated;

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (1, 'Staff Area', '員工區辦公台', '標準員工台', 'MFC', '1200W*600D*750H', 'PC', 1200, '350-450｜未來、傑尚', '600-800｜華旦、迪歐、高卓', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (2, 'Staff Area', '員工區辦公台', '員工台-帶櫃、擋板、桌上屏風', 'MFC', '1200W*600D*750H', 'Set', 1500, '450-580｜未來、傑尚、向氏', '600-800｜華旦、迪歐、高卓', 98);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (3, 'Staff Area', '員工區辦公台', '', 'MFC', '1400W*600D*750H', 'Set', 1800, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (4, 'Staff Area', '員工區辦公台', '', 'MFC', '1600W*600D*750H', 'Set', 2200, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (5, 'Staff Area', '升降桌', '員工升降台連屏風', 'MFC', 'under1800W*600D*1100H', 'Set', 6500, '2000左右｜樂贊、恆楓', '3200左右｜捷昌', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (6, 'Staff Area', '員工椅', '標準價', 'Mesh', '', 'PC', 800, '200-600｜名爵軒、華座、UBL', '300-800｜富凱', 98);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (7, 'Staff Area', '員工椅', '中價', 'Mesh', '', 'PC', 1100, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (8, 'Staff Area', '員工椅', '貴價', 'Mesh', '', 'PC', 1800, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (9, 'Staff Area', '文件高櫃-板式', '標準價', 'MFC', '800W*400D*2000H', 'PC', 2000, '450-600｜未來、傑尚、向氏', '600-800｜華旦、迪歐、高卓', 25);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (10, 'Staff Area', '文件高櫃-鋼製', '標準價', 'Steel', '800-900W*400D*1800-2000H', 'PC', 2800, '450-600｜九都、騰樂', '900-1400｜維格、歐卓美', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (11, 'Staff Area', '文件矮櫃-板式', '標準價', 'MFC', '800W*400D*800H', 'PC', 1100, '220-350｜未來、傑尚、向氏', '400-600｜華旦、迪歐、高卓', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (12, 'Staff Area', '文件矮櫃-鋼製', '標準價', 'Steel', '800W*400D*800H', 'PC', 1600, '330-450｜九都、騰樂', '600-750｜維格、歐卓美', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (13, 'Meeting Room', '會議桌', '中價3-4人', 'MFC - 圓檯', 'ø800*750H', 'PC', 1620, '400-500｜未來、傑尚、向氏、優卓、標冠', '500-600｜京圖', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (14, 'Meeting Room', '會議桌', '中價3-4人', 'MFC - 方檯', '800W*800D*750H', 'PC', 1620, '400-500｜未來、傑尚、向氏、優卓、標冠', '500-600｜京圖', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (15, 'Meeting Room', '會議桌', '中價4-8人', 'MFC - 方檯', '1600W*800D*750H', 'PC', 2200, '', '', 1);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (16, 'Meeting Room', '會議桌', '中價4-8人', '木皮 - 油漆方檯', '1600W*800D*750H', 'PC', 6600, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (17, 'Meeting Room', '會議桌', '中價10-12人', 'MFC - 方檯', '4200W*1800D*750H', 'PC', 7500, '', '', 2);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (18, 'Meeting Room', '會議桌', '貴價10-12人', '木皮 - 特色方檯', '4200W*1800D*750H', 'PC', 18000, '', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (19, 'Meeting Room', '培訓摺曡桌', '標準價', 'MFC - 長方檯連檔板', 'under1600W*600D*7500H', 'PC', 1800, '300-500｜于勤', '', 1);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (20, 'Meeting Room', '會議椅', '標準價', '膠椅', '', 'PC', 800, '150-200｜名爵軒、華座、UBL', '', 28);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (21, 'Meeting Room', '會議椅', '中價', '疊椅(弓腳)', '', 'PC', 750, '150-200｜名爵軒、華座、UBL', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (22, 'Meeting Room', '會議椅', '貴價', '皮椅', '', 'PC', 2200, '450-700｜名爵軒、華座', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (23, 'Big Boss Room', '老闆台', '標準價', 'MFC', '2400W*2000D*750H', 'PC', 6000, '1500-2200｜未來、傑尚、向氏', '', 3);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (24, 'Big Boss Room', '老闆台', '中價', '木皮-油漆', '2400W*2000D*750H', 'PC', 12000, '2500-4000｜華旦、迪歐、高卓', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (25, 'Big Boss Room', '大班椅', '中價', '半真皮', '', 'PC', 2600, '700-1000｜名爵軒、華座', '', 3);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (26, 'Big Boss Room', '大班椅', '貴價', '半真皮', '', 'PC', 4800, '2000-3000｜名爵軒、華座', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (27, 'Big Boss Room', '班前椅', '標準價', 'Mesh', '', 'PC', 875, '200-300｜名爵軒、華座、UBL', '', 6);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (28, 'Big Boss Room', '班前椅', '中價', '半真皮', '', 'PC', 2200, '450-700｜名爵軒、華座', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (29, 'Big Boss Room', '班前椅', '貴價', '半真皮', '', 'PC', 4000, '1000-1500｜名爵軒、華座', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (30, 'Big Boss Room', 'High Cabinet - Tailor-made', '中價', 'MFC', '1000W*400D*2000H', 'METER(W)', 2500, '800-1000｜未來、傑尚、向氏', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (31, 'Big Boss Room', 'High Cabinet - Tailor-made', '貴價', 'MFC', '1000W*400D*2000H', 'METER(W)', 5000, '1500-2000｜未來、傑尚、向氏', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (32, 'Director Room', '主任、經理台', '標準價', 'MFC', '2000W*1600D*750H', 'PC', 5000, '1500-2000｜未來、傑尚、向氏', '', 2);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (33, 'Director Room', '主任、經理台', '中價', '木皮-油漆', '2000W*1600D*750H', 'PC', 10000, '2000-3500｜華旦、迪歐、高卓', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (34, 'Director Room', '班椅', '中價', '半真皮', '', 'PC', 2600, '500-800｜名爵軒、華座', '', 2);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (35, 'Director Room', '班椅', '貴價', '半真皮', '', 'PC', 4800, '1500-2000｜名爵軒、華座', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (36, 'Director Room', '班前椅', '標準價', 'Mesh', '', 'PC', 800, '200-300｜名爵軒、華座、UBL', '', 4);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (37, 'Director Room', '班前椅', '中價', 'Mesh', '', 'PC', 1400, '450-700｜名爵軒、華座、UBL', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (38, 'Director Room', '班前椅', '貴價', 'Mesh', '', 'PC', 2000, '700-1000｜名爵軒、華座、UBL', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (39, 'Director Room', 'High Cabinet - Tailor-made', '中價', 'MFC', '1000W*400D*2000H', 'METER(W)', 2500, '800-1000｜未來、傑尚、向氏', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (40, 'Director Room', 'High Cabinet - Tailor-made', '貴價', 'MFC', '1000W*400D*2000H', 'METER(W)', 5000, '1500-2000｜未來、傑尚、向氏', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (41, 'Reception', 'Sofa沙發', '中價1人', '布藝/PU皮', '', 'PC', 2200, '700-900｜未來、傑尚、向氏、優卓、標冠', '', 1);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (42, 'Reception', 'Sofa沙發', '中價2-3人', '布藝/PU皮', '', 'PC', 5000, '1500-2500｜未來、傑尚、向氏、優卓、標冠', '', 1);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (43, 'Reception', 'Sofa沙發', '貴價1人', '半真皮 / 仿皮', '', 'PC', 3800, '1200-1500｜未來、傑尚、向氏、優卓、標冠', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (44, 'Reception', 'Sofa沙發', '貴價2-3人', '半真皮 / 仿皮', '', 'PC', 8000, '2500-4000｜未來、傑尚、向氏、優卓、標冠', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (45, 'Reception', 'Coffee table茶几', '標準價', '玻璃+鋼架', '1200W*600D*430H', 'PC', 1500, '300-500｜沃高、旭峰', '', 1);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (46, 'Reception', 'Coffee table茶几', '中價', '岩板+鋼架', '1200W*600D*430H', 'PC', 2600, '400-600｜沃高、旭峰', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (47, 'Reception', 'Coffee table茶几', '貴價', '岩板/油漆/中纖板', '1200W*600D*430H', 'PC', 3500, '800-1200｜京圖、優卓、標冠、爵尚', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (48, 'PhoneBooth', 'PhoneBooth 靜音艙', '單人', '連企檯吧椅', '1000W X 1159D X 2200H', 'PC', 25000, '11000｜新葉、百搭', '', 0);

insert into public.fds_package_price_lines (sort_order, area, item_name, grade, material, dimension_text, unit_text, unit_price, standard_note, premium_note, default_quantity) values (49, 'PhoneBooth', 'PhoneBooth 靜音艙', '4人', '連沙發椅', '2000W X 1500D X 2200H', 'PC', 42000, '20000｜新葉、百搭', '', 0);

notify pgrst, 'reload schema';
