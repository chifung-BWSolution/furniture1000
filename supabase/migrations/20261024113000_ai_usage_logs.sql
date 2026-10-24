-- AI 用量統計：Edge Function 的 Gemini / OCR 呼叫逐次記錄。
-- Tripo 不寫這張表：點數已在 processing_jobs（result->credits_consumed、tokens、cost_actual）。
create table if not exists public.ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  feature text,
  model text,
  user_id uuid,
  user_email text,
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  meta jsonb not null default '{}'::jsonb
);

comment on table public.ai_usage_logs is
  'AI 用量逐次記錄（Edge Function 寫入，service_role）。讀取限 admin / uploader。';

create index if not exists ai_usage_logs_created_idx
  on public.ai_usage_logs (created_at desc);
create index if not exists ai_usage_logs_source_idx
  on public.ai_usage_logs (source, created_at desc);

alter table public.ai_usage_logs enable row level security;
revoke all on public.ai_usage_logs from public, anon, authenticated;
grant select on public.ai_usage_logs to authenticated;
grant all on public.ai_usage_logs to service_role;

drop policy if exists "ai_usage_logs_read_admin_uploader" on public.ai_usage_logs;
create policy "ai_usage_logs_read_admin_uploader"
  on public.ai_usage_logs for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

notify pgrst, 'reload schema';
