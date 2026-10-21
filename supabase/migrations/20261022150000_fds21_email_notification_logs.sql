-- 系統電郵發送紀錄。永久保留。
-- 客戶端只可讀（管理員）。寫入由 edge function 用 service role 完成，不開放 insert。

create table if not exists public.email_notification_logs (
  id uuid primary key default gen_random_uuid(),
  sent_at timestamptz not null default now(),
  recipient text not null,
  notification_type text not null,
  related_quote_id text,
  related_product_id text,
  status text not null check (status in ('success', 'failed')),
  error_message text,
  provider text,
  message_id text,
  payload jsonb not null default '{}'::jsonb,
  resend_of uuid references public.email_notification_logs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists email_notification_logs_sent_idx
  on public.email_notification_logs (sent_at desc);

create index if not exists email_notification_logs_type_idx
  on public.email_notification_logs (notification_type, sent_at desc);

alter table public.email_notification_logs enable row level security;
revoke all on table public.email_notification_logs from public, anon, authenticated;
grant select on table public.email_notification_logs to authenticated;

drop policy if exists "email_notification_logs_select_admin" on public.email_notification_logs;
create policy "email_notification_logs_select_admin"
  on public.email_notification_logs
  for select
  to authenticated
  using (public.bwf_has_role(array['admin']));
