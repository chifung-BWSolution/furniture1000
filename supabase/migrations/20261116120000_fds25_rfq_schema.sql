-- FDS Supplier RFQ（第一期乙 §7.8）：表、索引、RLS、共用輔助函式。
-- 商業表不給 anon／authenticated 直接讀寫；全部走 SECURITY DEFINER RPC。
-- 封標與角色判斷都在 SQL 內分支，前端只收到已准許的欄位。

-- ── 編號流水 ─────────────────────────────────────────────────────────
-- 每年一張 RFQ-{年}-{四位流水}；用 upsert 保證並行建立不重號。
create table if not exists public.fds_rfq_number_seq (
  year integer primary key,
  last_no integer not null default 0 check (last_no >= 0)
);

alter table public.fds_rfq_number_seq enable row level security;
revoke all on public.fds_rfq_number_seq from public, anon, authenticated;
grant all on public.fds_rfq_number_seq to service_role;

-- ── 表頭 ─────────────────────────────────────────────────────────────
create table if not exists public.fds_rfqs (
  id uuid primary key default gen_random_uuid(),
  rfq_no text not null unique,
  title text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft'
    check (status in ('draft', 'open', 'review', 'awarded', 'not_awarded', 'cancelled')),
  revision integer not null default 0 check (revision >= 0),
  close_at timestamptz,
  sealed_bid boolean not null default true,
  revealed_at timestamptz,
  reveal_reason text,
  source_quote_id uuid references public.bwf_quote(id) on delete set null,
  notes text,
  cancel_reason text,
  published_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fds_rfqs_title_len check (char_length(title) <= 300),
  constraint fds_rfqs_reveal_reason_len check (reveal_reason is null or char_length(reveal_reason) <= 2000),
  constraint fds_rfqs_cancel_reason_len check (cancel_reason is null or char_length(cancel_reason) <= 2000)
);

create index if not exists fds_rfqs_status_idx
  on public.fds_rfqs (status, created_at desc);
create index if not exists fds_rfqs_close_idx
  on public.fds_rfqs (close_at) where close_at is not null;

-- ── 行 ───────────────────────────────────────────────────────────────
create table if not exists public.fds_rfq_items (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.fds_rfqs(id) on delete cascade,
  -- 草稿為 0；發布後為 1；每次修訂新增一整組行，舊行保留給舊回價／舊定標。
  revision integer not null default 0 check (revision >= 0),
  sort_order integer not null default 0,
  name text not null,
  model text,
  quantity numeric not null default 1 check (quantity > 0),
  unit text,
  specifications text,
  dimensions text,
  image_url text,
  product_id text references public.products(id) on delete set null,
  source_quote_id uuid references public.bwf_quote(id) on delete set null,
  source_quote_item_id uuid references public.bwf_quote_item(id) on delete set null,
  -- open = 未決定；awarded = 已定標；no_award = 此行不定標
  resolution text not null default 'open'
    check (resolution in ('open', 'awarded', 'no_award')),
  resolution_reason text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fds_rfq_items_name_len check (char_length(name) <= 500)
);

create index if not exists fds_rfq_items_rfq_idx
  on public.fds_rfq_items (rfq_id, revision, sort_order);
create index if not exists fds_rfq_items_product_idx
  on public.fds_rfq_items (product_id) where product_id is not null;

-- ── 受邀廠家（每個修訂一份） ─────────────────────────────────────────
create table if not exists public.fds_rfq_invitations (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.fds_rfqs(id) on delete cascade,
  revision integer not null check (revision >= 0),
  factory_id text not null,
  factory_name text not null default '',
  contact_email text,
  status text not null default 'invited'
    check (status in ('invited', 'submitted', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, revision, factory_id)
);

create index if not exists fds_rfq_invitations_rfq_idx
  on public.fds_rfq_invitations (rfq_id, revision);

-- ── 連結 token（只存 SHA-256） ───────────────────────────────────────
create table if not exists public.fds_rfq_invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.fds_rfq_invitations(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists fds_rfq_tokens_invitation_idx
  on public.fds_rfq_invitation_tokens (invitation_id, created_at desc);

-- ── 回價版本 ─────────────────────────────────────────────────────────
create table if not exists public.fds_rfq_submissions (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.fds_rfqs(id) on delete cascade,
  invitation_id uuid not null references public.fds_rfq_invitations(id) on delete cascade,
  factory_id text not null,
  revision integer not null check (revision >= 1),
  version integer not null check (version >= 1),
  status text not null default 'submitted'
    check (status in ('submitted', 'withdrawn')),
  receipt_code text not null unique,
  content_hash text not null,
  idempotency_key text,
  submitter_email text not null,
  submitted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  unique (invitation_id, version)
);

-- 冪等鍵以「邀請」為範圍：同一張 RFQ 的不同廠不會互相撞回執。
drop index if exists public.fds_rfq_submissions_idempotency_uidx;
create unique index if not exists fds_rfq_submissions_idempotency_uidx
  on public.fds_rfq_submissions (invitation_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists fds_rfq_submissions_rfq_idx
  on public.fds_rfq_submissions (rfq_id, revision, status);

-- ── 回價明細 ─────────────────────────────────────────────────────────
create table if not exists public.fds_rfq_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.fds_rfq_submissions(id) on delete cascade,
  rfq_item_id uuid not null references public.fds_rfq_items(id) on delete cascade,
  unit_price numeric check (unit_price is null or unit_price >= 0),
  no_quote boolean not null default false,
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  validity_days integer check (validity_days is null or validity_days >= 0),
  moq numeric check (moq is null or moq >= 0),
  package_qty numeric check (package_qty is null or package_qty >= 0),
  volume numeric check (volume is null or volume >= 0),
  alternate_product_id text references public.products(id) on delete set null,
  alternate_text text,
  note text,
  created_at timestamptz not null default now(),
  unique (submission_id, rfq_item_id)
);

create index if not exists fds_rfq_submission_items_item_idx
  on public.fds_rfq_submission_items (rfq_item_id);

-- ── 專案價快照（不寫 supplier_prices、不寫 bwf_quote） ──────────────
create table if not exists public.fds_rfq_awards (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.fds_rfqs(id) on delete cascade,
  rfq_item_id uuid not null references public.fds_rfq_items(id) on delete cascade,
  invitation_id uuid not null references public.fds_rfq_invitations(id) on delete restrict,
  submission_id uuid not null references public.fds_rfq_submissions(id) on delete restrict,
  submission_item_id uuid not null references public.fds_rfq_submission_items(id) on delete restrict,
  factory_id text not null,
  factory_name text,
  version integer not null,
  unit_price numeric not null check (unit_price >= 0),
  currency text not null,
  quantity numeric not null,
  reason text not null,
  status text not null default 'active'
    check (status in ('active', 'reopened', 'cancelled')),
  awarded_by uuid,
  awarded_by_email text,
  awarded_at timestamptz not null default now(),
  reopened_by uuid,
  reopened_by_email text,
  reopened_at timestamptz,
  reopen_reason text,
  cancelled_at timestamptz,
  constraint fds_rfq_awards_reason_len check (char_length(reason) <= 2000)
);

-- 同一行同時只有一個有效定標。
create unique index if not exists fds_rfq_awards_active_line_uidx
  on public.fds_rfq_awards (rfq_item_id)
  where status = 'active';
create index if not exists fds_rfq_awards_rfq_idx
  on public.fds_rfq_awards (rfq_id, awarded_at desc);

-- ── 事件 ─────────────────────────────────────────────────────────────
create table if not exists public.fds_rfq_events (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references public.fds_rfqs(id) on delete cascade,
  rfq_item_id uuid references public.fds_rfq_items(id) on delete set null,
  invitation_id uuid references public.fds_rfq_invitations(id) on delete set null,
  event_type text not null,
  actor_kind text not null default 'staff'
    check (actor_kind in ('staff', 'supplier', 'link', 'system')),
  actor_email text,
  actor_user_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fds_rfq_events_rfq_idx
  on public.fds_rfq_events (rfq_id, created_at desc);

-- ── RLS：全部關掉直讀，只留 service_role ─────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'fds_rfqs', 'fds_rfq_items', 'fds_rfq_invitations',
    'fds_rfq_invitation_tokens', 'fds_rfq_submissions',
    'fds_rfq_submission_items', 'fds_rfq_awards', 'fds_rfq_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end
$$;

-- ── 共用判斷 ─────────────────────────────────────────────────────────
-- 截止後未結束的表頭「視為 review」，不改寫資料列。
create or replace function public.fds_rfq_effective_status(
  p_status text,
  p_close_at timestamptz
) returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status = 'open' and p_close_at is not null and p_close_at <= now() then 'review'
    else p_status
  end;
$$;

-- 已揭標：提前揭標（清掉封標）或截止已到。
create or replace function public.fds_rfq_is_revealed(
  p_sealed boolean,
  p_revealed_at timestamptz,
  p_close_at timestamptz
) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_sealed, true) is false
    or p_revealed_at is not null
    or (p_close_at is not null and p_close_at <= now());
$$;

create or replace function public.fds_rfq_hash_token(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(coalesce(p_token, ''), 'utf8'), 'sha256'::text),
    'hex'
  );
$$;

-- token → 邀請／RFQ。無效、過期、作廢、修訂不符、整張取消都在這裡擋。
create or replace function public.fds_rfq_token_context(p_token text)
returns table (
  token_id uuid,
  invitation_id uuid,
  rfq_id uuid,
  invitation_revision integer,
  factory_id text,
  factory_name text,
  contact_email text,
  rfq_no text,
  title text,
  currency text,
  rfq_status text,
  close_at timestamptz,
  sealed_bid boolean,
  revealed_at timestamptz,
  rfq_revision integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_row record;
begin
  if p_token is null or char_length(btrim(p_token)) < 16 then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;

  v_hash := public.fds_rfq_hash_token(btrim(p_token));

  select
    t.id as token_id,
    i.id as invitation_id,
    r.id as rfq_id,
    i.revision as invitation_revision,
    i.factory_id,
    i.factory_name,
    i.contact_email,
    r.rfq_no,
    r.title,
    r.currency,
    r.status as rfq_status,
    r.close_at,
    r.sealed_bid,
    r.revealed_at,
    r.revision as rfq_revision
  into v_row
  from public.fds_rfq_invitation_tokens t
  join public.fds_rfq_invitations i on i.id = t.invitation_id
  join public.fds_rfqs r on r.id = i.rfq_id
  where t.token_hash = v_hash
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if not found then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;
  if v_row.invitation_revision <> v_row.rfq_revision then
    raise exception 'revision_mismatch' using errcode = 'P0001';
  end if;
  if v_row.rfq_status = 'cancelled' then
    raise exception 'token_invalid' using errcode = 'P0001';
  end if;

  return query
  select
    v_row.token_id,
    v_row.invitation_id,
    v_row.rfq_id,
    v_row.invitation_revision,
    v_row.factory_id,
    v_row.factory_name,
    v_row.contact_email,
    v_row.rfq_no,
    v_row.title,
    v_row.currency,
    v_row.rfq_status,
    v_row.close_at,
    v_row.sealed_bid,
    v_row.revealed_at,
    v_row.rfq_revision;
end;
$$;

revoke all on function public.fds_rfq_effective_status(text, timestamptz) from public, anon, authenticated;
revoke all on function public.fds_rfq_is_revealed(boolean, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fds_rfq_hash_token(text) from public, anon, authenticated;
revoke all on function public.fds_rfq_token_context(text) from public, anon, authenticated;

notify pgrst, 'reload schema';
