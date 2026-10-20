-- ============================================================================
-- FDS 2.1 Day 9 (T-901, F-AI-009) — Canva 連接（chifung.login 帳戶）
-- OAuth Authorization-Code + PKCE 的 access/refresh token 只放在這裡；
-- RLS 啟用、不建任何 policy → 僅 service role（edge function）可讀寫，
-- 一般角色（含 admin）無法經 PostgREST 拿到 token。
-- ============================================================================
create table if not exists public.canva_connections (
  staff_id uuid primary key references auth.users (id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  account_name text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.canva_connections enable row level security;

comment on table public.canva_connections is
  'FDS 2.1 Canva Connect (chifung.login) user tokens. Service-role only; no policies.';

-- ============================================================================
-- 匯入審計（決議 9.1：匯入留 creator staff 與時間）。本人可讀自己的記錄，
-- 寫入只在 edge（service role）。設計 ID 存著：edit_url 30 天後過期，
-- 需要 new edit_url 時可用 design API 重新取。
-- ============================================================================
create table if not exists public.canva_imports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users (id) on delete cascade,
  design_id text not null,
  title text,
  file_name text,
  product_ids uuid[] not null default '{}',
  edit_url text,
  created_at timestamptz not null default now()
);

alter table public.canva_imports enable row level security;

drop policy if exists canva_imports_select_own on public.canva_imports;
create policy canva_imports_select_own on public.canva_imports
  for select to authenticated
  using (staff_id = auth.uid());

comment on table public.canva_imports is
  'FDS 2.1 Canva design import audit rows. Insert via edge (service role); staff read their own.';
