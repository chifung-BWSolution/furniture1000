-- 停用 Tripo（尺寸驅動傢俬建模 PRD FR-01）。
-- 不再接受新的 Tripo 提交：舊前端、直接呼叫 RPC、service role 直接 insert 都會被拒。
-- 已取得供應商 task_id 的任務仍由 process-jobs 查詢及下載；歷史模型、點數與失敗紀錄全部保留。

drop policy if exists product_models_tripo_reference_insert on storage.objects;

create or replace function public.fds_request_tripo_model(
  p_product_id text, p_reference_path text, p_request_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'tripo_disabled'
    using errcode = '42501', hint = 'Tripo 已停用，請改用尺寸驅動建模或沿用既有模型';
end;
$$;
revoke all on function public.fds_request_tripo_model(text, text, uuid) from public, anon;
grant execute on function public.fds_request_tripo_model(text, text, uuid) to authenticated;

create or replace function public.fds_block_new_tripo_jobs()
returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.job_type = 'generate_tripo' then
    raise exception 'tripo_disabled' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.fds_block_new_tripo_jobs() from public, anon, authenticated;

drop trigger if exists trg_block_new_tripo_jobs on public.processing_jobs;
create trigger trg_block_new_tripo_jobs
  before insert on public.processing_jobs
  for each row execute function public.fds_block_new_tripo_jobs();

-- 尚未向供應商提交：停止，不轉往其他服務。
update public.processing_jobs
set status = 'cancelled',
    error = 'Tripo 已停用：任務尚未提交供應商，已停止，不會轉往其他服務',
    finished_at = now(),
    updated_at = now()
where job_type = 'generate_tripo'
  and status in ('queued', 'running')
  and coalesce(payload -> 'state' ->> 'task_id', '') = ''
  and coalesce((payload -> 'state' ->> 'submission_started')::boolean, false) = false;

-- 已開始提交但沒有 task_id：結果不明，標記待人工核對，不自動重試。
update public.processing_jobs
set status = 'failed',
    attempts = max_attempts,
    error = 'Tripo 已停用：提交結果不明，待人工到 Tripo 後台核對；不會自動重試',
    finished_at = now(),
    updated_at = now()
where job_type = 'generate_tripo'
  and status in ('queued', 'running')
  and coalesce(payload -> 'state' ->> 'task_id', '') = ''
  and coalesce((payload -> 'state' ->> 'submission_started')::boolean, false) = true;

notify pgrst, 'reload schema';
