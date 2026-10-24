-- FDS 每日指令記錄 — 歷史／批量匯入。
--
-- 對照 QMS `202609290006_qms_development_command_log_import.sql`：外部工具
-- （opencode／ChatGPT(Codex)／Cursor／WorkBuddy）的本機歷史需要一條可重跑的
-- 批量匯入通道，以 external_id 在伺服器端去重。FDS 既有契約沿用：
--   * 表 `bwf_development_command_logs` 與 partial unique index
--     `(developer_email, external_id) where external_id is not null`
--     已在 20261014_bwf_development_ops.sql 存在，不動。
--   * 開發者解析照 `bwf_dev_command_log_start`：按 email 查
--     `platform_user_profiles` 取 display_name／auth_user_id，查不到不拒絕
--     （fallback 顯示名 = email 前綴），與既有 start 行為一致。
-- Append-only：匯入只 insert 新列，永不改寫已存在的列。

create or replace function public.bwf_dev_command_log_import(p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_record jsonb;
  v_index integer := 0;
  v_inserted integer := 0;
  v_skipped integer := 0;
  v_rejected integer := 0;
  v_rejections jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_email text;
  v_user uuid;
  v_name text;
  v_instruction text;
  v_status text;
  v_started timestamptz;
  v_completed timestamptz;
  v_duration integer;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'invalid_records' using errcode = '22023';
  end if;
  if jsonb_array_length(p_records) > 500 then
    raise exception 'too_many_records' using errcode = '22023';
  end if;

  for v_record in select value from jsonb_array_elements(p_records) loop
    v_index := v_index + 1;
    begin
      v_email := lower(nullif(btrim(v_record->>'developerEmail'), ''));
      v_instruction := nullif(btrim(v_record->>'instructionText'), '');
      v_status := coalesce(nullif(btrim(v_record->>'status'), ''), 'completed');
      if v_email is null or position('@' in v_email) = 0 then
        raise exception 'developer_email_invalid' using errcode = '22023';
      end if;
      if v_instruction is null then
        raise exception 'instruction_text_required' using errcode = '22023';
      end if;
      if v_status not in ('running', 'completed', 'failed', 'cancelled') then
        raise exception 'record_invalid_status' using errcode = '22023';
      end if;
      if char_length(v_instruction) > 20000 then
        raise exception 'record_instruction_too_long' using errcode = '22023';
      end if;

      -- 與 bwf_dev_command_log_start 相同的開發者解析（不拒絕未知 email）。
      select p.auth_user_id, coalesce(nullif(btrim(coalesce(p.display_name, '')), ''), split_part(v_email, '@', 1))
        into v_user, v_name
      from public.platform_user_profiles p
      where lower(p.email) = v_email
      order by p.updated_at desc nulls last
      limit 1;
      v_user := coalesce(v_user, null);
      v_name := coalesce(v_name, split_part(v_email, '@', 1));

      v_started := coalesce(nullif(btrim(v_record->>'startedAt'), '')::timestamptz, timezone('utc', now()));
      v_completed := nullif(btrim(v_record->>'completedAt'), '')::timestamptz;
      if v_status <> 'running' and v_completed is null then
        v_completed := v_started;
      end if;
      if v_completed is not null and v_completed < v_started then
        v_completed := v_started;
      end if;
      v_duration := case when v_completed is null then null
        else greatest(0, floor(extract(epoch from (v_completed - v_started)))::int) end;

      insert into public.bwf_development_command_logs (
        developer_auth_user_id, developer_name, developer_email,
        instruction_text, task_reference, model, status,
        started_at, completed_at, duration_seconds,
        input_tokens, cached_input_tokens, output_tokens,
        credits_used, cost_usd, result_summary, failure_reason,
        external_id
      ) values (
        v_user, v_name, v_email,
        v_instruction,
        nullif(btrim(v_record->>'taskReference'), ''),
        nullif(btrim(v_record->>'model'), ''),
        v_status,
        v_started, v_completed, v_duration,
        nullif(btrim(v_record->>'inputTokens'), '')::bigint,
        nullif(btrim(v_record->>'cachedInputTokens'), '')::bigint,
        nullif(btrim(v_record->>'outputTokens'), '')::bigint,
        nullif(btrim(v_record->>'creditsUsed'), '')::numeric,
        nullif(btrim(v_record->>'costUsd'), '')::numeric,
        nullif(btrim(v_record->>'resultSummary'), ''),
        nullif(btrim(v_record->>'failureReason'), ''),
        nullif(btrim(v_record->>'externalId'), '')
      )
      on conflict (developer_email, external_id) where external_id is not null do nothing;

      get diagnostics v_row_count = row_count;
      if v_row_count > 0 then
        v_inserted := v_inserted + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_rejected := v_rejected + 1;
      if jsonb_array_length(v_rejections) < 50 then
        v_rejections := v_rejections || jsonb_build_object('index', v_index, 'error', sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'skipped', v_skipped,
    'rejected', v_rejected,
    'rejections', v_rejections
  );
end;
$$;

comment on function public.bwf_dev_command_log_import(jsonb) is
  'Service-role batch import of developer-tool command history (opencode/Codex/Cursor/WorkBuddy): explicit started/completed times, developer resolved from platform_user_profiles like bwf_dev_command_log_start, and ON CONFLICT (developer_email, external_id) idempotency. Max 500 records per call.';

revoke all on function public.bwf_dev_command_log_import(jsonb) from public, anon, authenticated;
grant execute on function public.bwf_dev_command_log_import(jsonb) to service_role;

notify pgrst, 'reload schema';
