-- Furniture 系統設定：每日指令記錄 + 開發成本。
-- 香港日期用 Asia/Hong_Kong；時間戳維持 timestamptz。
-- 讀寫只經 SECURITY DEFINER RPC，系統管理員由 platform_user_profiles.role = admin 判定。

create table if not exists public.bwf_development_command_logs (
  id uuid primary key default gen_random_uuid(),
  developer_auth_user_id uuid,
  developer_name text not null,
  developer_email text not null,
  instruction_text text not null,
  task_reference text,
  model text,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  cached_input_tokens bigint check (cached_input_tokens is null or cached_input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  credits_used numeric(18, 6) check (credits_used is null or credits_used >= 0),
  cost_usd numeric(18, 6) check (cost_usd is null or cost_usd >= 0),
  result_summary text,
  failure_reason text,
  external_id text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint bwf_dev_logs_instruction_len check (char_length(instruction_text) <= 20000),
  constraint bwf_dev_logs_name_len check (char_length(developer_name) <= 200 and char_length(developer_email) <= 320),
  constraint bwf_dev_logs_text_len check (
    (result_summary is null or char_length(result_summary) <= 5000)
    and (failure_reason is null or char_length(failure_reason) <= 2000)
    and (task_reference is null or char_length(task_reference) <= 300)
    and (model is null or char_length(model) <= 200)
    and (external_id is null or char_length(external_id) <= 300)
  ),
  constraint bwf_dev_logs_final_completed check (status = 'running' or completed_at is not null)
);

create index if not exists bwf_dev_logs_started_idx
  on public.bwf_development_command_logs (started_at desc);
create unique index if not exists bwf_dev_logs_external_idx
  on public.bwf_development_command_logs (developer_email, external_id)
  where external_id is not null;

alter table public.bwf_development_command_logs enable row level security;
revoke all on public.bwf_development_command_logs from public, anon, authenticated;
grant select, insert, update, delete on public.bwf_development_command_logs to service_role;

create table if not exists public.bwf_development_cost_settings (
  setting_key text primary key check (setting_key = 'app_development_hourly_rate'),
  current_revision bigint not null default 0 check (current_revision >= 0),
  updated_at timestamptz,
  updated_by_auth_user_id uuid
);

insert into public.bwf_development_cost_settings (setting_key)
values ('app_development_hourly_rate')
on conflict (setting_key) do nothing;

create table if not exists public.bwf_development_hourly_rate_versions (
  id uuid primary key default gen_random_uuid(),
  revision_no bigint not null unique,
  effective_from date not null,
  hourly_rate_hkd numeric(12, 2) not null check (hourly_rate_hkd > 0),
  change_reason text not null check (char_length(btrim(change_reason)) between 3 and 300),
  created_at timestamptz not null default timezone('utc', now()),
  created_by_auth_user_id uuid,
  created_by_name text not null default '',
  created_by_email text not null default ''
);

create index if not exists bwf_dev_rate_effective_idx
  on public.bwf_development_hourly_rate_versions (effective_from desc, revision_no desc);

create or replace function public.bwf_development_rate_version_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'rate_version_immutable' using errcode = '42501';
end;
$$;

drop trigger if exists bwf_dev_rate_version_no_mutation on public.bwf_development_hourly_rate_versions;
create trigger bwf_dev_rate_version_no_mutation
  before update or delete on public.bwf_development_hourly_rate_versions
  for each row execute function public.bwf_development_rate_version_immutable();

alter table public.bwf_development_cost_settings enable row level security;
alter table public.bwf_development_hourly_rate_versions enable row level security;
revoke all on public.bwf_development_cost_settings from public, anon, authenticated;
revoke all on public.bwf_development_hourly_rate_versions from public, anon, authenticated;
grant select, insert, update on public.bwf_development_cost_settings to service_role;
grant select, insert on public.bwf_development_hourly_rate_versions to service_role;

create or replace function public.bwf_assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.platform_user_profiles p
    where p.active is true
      and lower(p.role) = 'admin'
      and (
        p.auth_user_id = auth.uid()
        or lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  ) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.bwf_assert_platform_admin() from public, anon, authenticated;

create or replace function public.bwf_development_rate_for_date(p_date date)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select v.hourly_rate_hkd
  from public.bwf_development_hourly_rate_versions v
  where v.effective_from <= p_date
  order by v.effective_from desc, v.revision_no desc
  limit 1;
$$;

revoke all on function public.bwf_development_rate_for_date(date) from public, anon, authenticated;

create or replace function public.bwf_dev_command_logs_list(
  p_from date default null,
  p_to date default null,
  p_developer_email text default null,
  p_status text default null,
  p_model text default null,
  p_search text default null,
  p_limit integer default 15,
  p_offset integer default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_rows jsonb;
  v_email text := nullif(lower(btrim(coalesce(p_developer_email, ''))), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_model text := nullif(btrim(coalesce(p_model, '')), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.bwf_assert_platform_admin();

  select count(*) into v_total
  from public.bwf_development_command_logs l
  where (p_from is null or (l.started_at at time zone 'Asia/Hong_Kong')::date >= p_from)
    and (p_to is null or (l.started_at at time zone 'Asia/Hong_Kong')::date <= p_to)
    and (v_email is null or lower(l.developer_email) = v_email)
    and (v_status is null or l.status = v_status)
    and (v_model is null or l.model = v_model)
    and (v_search is null
      or l.instruction_text ilike '%' || v_search || '%'
      or coalesce(l.result_summary, '') ilike '%' || v_search || '%'
      or coalesce(l.task_reference, '') ilike '%' || v_search || '%'
      or l.developer_name ilike '%' || v_search || '%');

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows
  from (
    select
      l.id,
      l.developer_name as "developerName",
      l.developer_email as "developerEmail",
      l.instruction_text as "instructionText",
      l.task_reference as "taskReference",
      l.model,
      l.status,
      l.started_at as "startedAt",
      l.completed_at as "completedAt",
      l.duration_seconds as "durationSeconds",
      l.input_tokens as "inputTokens",
      l.cached_input_tokens as "cachedInputTokens",
      l.output_tokens as "outputTokens",
      l.credits_used as "creditsUsed",
      l.cost_usd as "costUsd",
      l.result_summary as "resultSummary",
      l.failure_reason as "failureReason",
      (l.started_at at time zone 'Asia/Hong_Kong')::date as "businessDate"
    from public.bwf_development_command_logs l
    where (p_from is null or (l.started_at at time zone 'Asia/Hong_Kong')::date >= p_from)
      and (p_to is null or (l.started_at at time zone 'Asia/Hong_Kong')::date <= p_to)
      and (v_email is null or lower(l.developer_email) = v_email)
      and (v_status is null or l.status = v_status)
      and (v_model is null or l.model = v_model)
      and (v_search is null
        or l.instruction_text ilike '%' || v_search || '%'
        or coalesce(l.result_summary, '') ilike '%' || v_search || '%'
        or coalesce(l.task_reference, '') ilike '%' || v_search || '%'
        or l.developer_name ilike '%' || v_search || '%')
    order by l.started_at desc
    limit greatest(1, least(coalesce(p_limit, 15), 2000))
    offset greatest(0, coalesce(p_offset, 0))
  ) x;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create or replace function public.bwf_dev_command_logs_analytics(
  p_from date default null,
  p_to date default null,
  p_developer_email text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (timezone('utc', now()) at time zone 'Asia/Hong_Kong')::date;
  v_month date := date_trunc('month', (timezone('utc', now()) at time zone 'Asia/Hong_Kong'))::date;
  v_email text := nullif(lower(btrim(coalesce(p_developer_email, ''))), '');
begin
  perform public.bwf_assert_platform_admin();

  return jsonb_build_object(
    'summary', (
      select jsonb_build_object(
        'todayCommandCount', count(*) filter (where business_date = v_today),
        'todayCompletedCount', count(*) filter (where business_date = v_today and status = 'completed'),
        'todayRunningCount', count(*) filter (where business_date = v_today and status = 'running'),
        'todayFailedCount', count(*) filter (where business_date = v_today and status = 'failed'),
        'todayCredits', coalesce(sum(credits_used) filter (where business_date = v_today), 0),
        'todayCostUsd', coalesce(sum(cost_usd) filter (where business_date = v_today), 0),
        'todayDurationSeconds', coalesce(sum(duration_seconds) filter (where business_date = v_today), 0),
        'monthCommandCount', count(*) filter (where business_date >= v_month),
        'monthCostUsd', coalesce(sum(cost_usd) filter (where business_date >= v_month), 0),
        'monthDurationSeconds', coalesce(sum(duration_seconds) filter (where business_date >= v_month), 0)
      )
      from (
        select
          l.status,
          l.credits_used,
          l.cost_usd,
          l.duration_seconds,
          (l.started_at at time zone 'Asia/Hong_Kong')::date as business_date
        from public.bwf_development_command_logs l
        where v_email is null or lower(l.developer_email) = v_email
      ) s
    ),
    'daily', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d."businessDate" desc, d."developerName"), '[]'::jsonb)
      from (
        select
          (l.started_at at time zone 'Asia/Hong_Kong')::date as "businessDate",
          l.developer_name as "developerName",
          l.developer_email as "developerEmail",
          count(*)::int as "totalCommands",
          count(*) filter (where l.status = 'completed')::int as "completedCount",
          count(*) filter (where l.status = 'failed')::int as "failedCount",
          coalesce(sum(l.credits_used), 0) as "totalCredits",
          coalesce(sum(l.cost_usd), 0) as "totalCostUsd",
          coalesce(sum(l.duration_seconds), 0)::bigint as "totalDurationSeconds"
        from public.bwf_development_command_logs l
        where (p_from is null or (l.started_at at time zone 'Asia/Hong_Kong')::date >= p_from)
          and (p_to is null or (l.started_at at time zone 'Asia/Hong_Kong')::date <= p_to)
          and (v_email is null or lower(l.developer_email) = v_email)
        group by 1, 2, 3
      ) d
    ),
    'developers', (
      select coalesce(jsonb_agg(to_jsonb(p) order by p."completedCount" desc, p."developerName"), '[]'::jsonb)
      from (
        select
          l.developer_name as "developerName",
          l.developer_email as "developerEmail",
          count(*)::int as "totalCommands",
          count(*) filter (where l.status = 'completed')::int as "completedCount",
          count(*) filter (where l.status = 'failed')::int as "failedCount",
          coalesce(sum(l.duration_seconds), 0)::bigint as "totalDurationSeconds",
          coalesce(sum(l.credits_used), 0) as "totalCredits",
          coalesce(sum(l.cost_usd), 0) as "totalCostUsd",
          count(distinct (l.started_at at time zone 'Asia/Hong_Kong')::date)::int as "activeDays"
        from public.bwf_development_command_logs l
        where (p_from is null or (l.started_at at time zone 'Asia/Hong_Kong')::date >= p_from)
          and (p_to is null or (l.started_at at time zone 'Asia/Hong_Kong')::date <= p_to)
          and (v_email is null or lower(l.developer_email) = v_email)
        group by 1, 2
      ) p
    ),
    'options', jsonb_build_object(
      'developers', (
        select coalesce(jsonb_agg(jsonb_build_object('email', email, 'name', name) order by name), '[]'::jsonb)
        from (
          select distinct lower(developer_email) as email, developer_name as name
          from public.bwf_development_command_logs
        ) people
      ),
      'models', (
        select coalesce(jsonb_agg(model order by model), '[]'::jsonb)
        from (select distinct model from public.bwf_development_command_logs where model is not null) m
      )
    )
  );
end;
$$;

create or replace function public.bwf_dev_command_log_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_platform_admin();
  delete from public.bwf_development_command_logs where id = p_id;
end;
$$;

create or replace function public.bwf_dev_command_log_start(
  p_developer_email text,
  p_instruction_text text,
  p_task_reference text default null,
  p_model text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(nullif(btrim(coalesce(p_developer_email, '')), ''));
  v_instruction text := nullif(btrim(coalesce(p_instruction_text, '')), '');
  v_name text;
  v_user uuid;
  v_id uuid;
begin
  if v_email is null or position('@' in v_email) = 0 then
    raise exception 'developer_email_invalid' using errcode = '22023';
  end if;
  if v_instruction is null then
    raise exception 'instruction_text_required' using errcode = '22023';
  end if;

  select p.display_name, p.auth_user_id
    into v_name, v_user
  from public.platform_user_profiles p
  where lower(p.email) = v_email
  order by p.updated_at desc nulls last
  limit 1;

  v_name := coalesce(nullif(btrim(coalesce(v_name, '')), ''), split_part(v_email, '@', 1));

  insert into public.bwf_development_command_logs (
    developer_auth_user_id, developer_name, developer_email, instruction_text, task_reference, model, status
  ) values (
    v_user, v_name, v_email, left(v_instruction, 20000), nullif(btrim(coalesce(p_task_reference, '')), ''), nullif(btrim(coalesce(p_model, '')), ''), 'running'
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'running');
end;
$$;

create or replace function public.bwf_dev_command_log_complete(
  p_id uuid,
  p_status text,
  p_model text default null,
  p_input_tokens bigint default null,
  p_cached_input_tokens bigint default null,
  p_output_tokens bigint default null,
  p_credits_used numeric default null,
  p_cost_usd numeric default null,
  p_result_summary text default null,
  p_failure_reason text default null,
  p_completed_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.bwf_development_command_logs%rowtype;
  v_completed timestamptz := coalesce(p_completed_at, timezone('utc', now()));
begin
  if p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'status_invalid' using errcode = '22023';
  end if;

  update public.bwf_development_command_logs
  set status = p_status,
      model = coalesce(nullif(btrim(coalesce(p_model, '')), ''), model),
      completed_at = v_completed,
      duration_seconds = greatest(0, floor(extract(epoch from (v_completed - started_at)))::int),
      input_tokens = p_input_tokens,
      cached_input_tokens = p_cached_input_tokens,
      output_tokens = p_output_tokens,
      credits_used = p_credits_used,
      cost_usd = p_cost_usd,
      result_summary = nullif(btrim(coalesce(p_result_summary, '')), ''),
      failure_reason = nullif(btrim(coalesce(p_failure_reason, '')), '')
  where id = p_id
    and status = 'running'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'log_not_open' using errcode = '22023';
  end if;

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'durationSeconds', v_row.duration_seconds);
end;
$$;

create or replace function public.bwf_development_cost_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', (timezone('utc', now()) at time zone 'Asia/Hong_Kong'))::date;
  v_revision bigint;
  v_current jsonb;
begin
  perform public.bwf_assert_platform_admin();

  select current_revision into v_revision
  from public.bwf_development_cost_settings
  where setting_key = 'app_development_hourly_rate';

  select jsonb_build_object(
    'revision', revision_no,
    'effectiveFrom', effective_from,
    'rate', hourly_rate_hkd
  ) into v_current
  from public.bwf_development_hourly_rate_versions
  where effective_from <= (timezone('utc', now()) at time zone 'Asia/Hong_Kong')::date
  order by effective_from desc, revision_no desc
  limit 1;

  return jsonb_build_object(
    'currentRevision', coalesce(v_revision, 0),
    'currentRate', v_current,
    'monthSummary', public.bwf_development_cost_span(v_month, (v_month + interval '1 month')::date),
    'appSummary', public.bwf_development_cost_span(null, null),
    'monthlyRows', (
      select coalesce(jsonb_agg(to_jsonb(m) order by m."monthStart" desc), '[]'::jsonb)
      from (
        select
          month_start as "monthStart",
          count(*)::int as "completedCount",
          coalesce(sum(duration_seconds), 0)::bigint as "durationSeconds",
          coalesce(sum(duration_seconds) filter (where rate is not null), 0)::bigint as "pricedSeconds",
          coalesce(sum(duration_seconds) filter (where rate is null), 0)::bigint as "unpricedSeconds",
          round(coalesce(sum(case when rate is not null then duration_seconds::numeric / 3600 * rate else 0 end), 0), 2) as "labourCostHkd",
          round(coalesce(sum(cost_usd), 0), 6) as "toolCostUsd",
          count(cost_usd)::int as "toolCostCount",
          min(rate) as "rateMin",
          max(rate) as "rateMax",
          count(distinct rate)::int as "rateCount",
          case
            when count(*) = 0 then 'none'
            when count(*) filter (where rate is null and coalesce(duration_seconds, 0) > 0) = 0 then 'priced'
            when count(*) filter (where rate is not null) = 0 then 'none'
            else 'partial'
          end as status
        from (
          select
            date_trunc('month', (l.started_at at time zone 'Asia/Hong_Kong'))::date as month_start,
            l.duration_seconds,
            l.cost_usd,
            public.bwf_development_rate_for_date((l.started_at at time zone 'Asia/Hong_Kong')::date) as rate
          from public.bwf_development_command_logs l
          where l.status = 'completed'
        ) priced
        group by month_start
      ) m
    ),
    'rateVersions', (
      select coalesce(jsonb_agg(to_jsonb(v) order by v."revision" desc), '[]'::jsonb)
      from (
        select
          revision_no as revision,
          effective_from as "effectiveFrom",
          hourly_rate_hkd as rate,
          change_reason as reason,
          created_at as "createdAt",
          created_by_name as "createdByName",
          created_by_email as "createdByEmail",
          case
            when revision_no = (
              select vv.revision_no
              from public.bwf_development_hourly_rate_versions vv
              where vv.effective_from <= (timezone('utc', now()) at time zone 'Asia/Hong_Kong')::date
              order by vv.effective_from desc, vv.revision_no desc
              limit 1
            ) then 'current'
            when effective_from > (timezone('utc', now()) at time zone 'Asia/Hong_Kong')::date then 'scheduled'
            else 'historical'
          end as status
        from public.bwf_development_hourly_rate_versions
      ) v
    )
  );
end;
$$;

create or replace function public.bwf_development_cost_span(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select
    count(*)::int as completed_count,
    coalesce(sum(l.duration_seconds), 0)::bigint as duration_seconds,
    coalesce(sum(l.duration_seconds) filter (where r.rate is not null), 0)::bigint as priced_seconds,
    coalesce(sum(l.duration_seconds) filter (where r.rate is null), 0)::bigint as unpriced_seconds,
    round(coalesce(sum(case when r.rate is not null then l.duration_seconds::numeric / 3600 * r.rate else 0 end), 0), 2) as labour_cost_hkd,
    round(coalesce(sum(l.cost_usd), 0), 6) as tool_cost_usd,
    count(l.cost_usd)::int as tool_cost_count
  into v_row
  from public.bwf_development_command_logs l
  left join lateral (
    select public.bwf_development_rate_for_date((l.started_at at time zone 'Asia/Hong_Kong')::date) as rate
  ) r on true
  where l.status = 'completed'
    and (p_from is null or (l.started_at at time zone 'Asia/Hong_Kong')::date >= p_from)
    and (p_to is null or (l.started_at at time zone 'Asia/Hong_Kong')::date < p_to);

  return jsonb_build_object(
    'completedCount', v_row.completed_count,
    'durationSeconds', v_row.duration_seconds,
    'pricedSeconds', v_row.priced_seconds,
    'unpricedSeconds', v_row.unpriced_seconds,
    'labourCostHkd', v_row.labour_cost_hkd,
    'toolCostUsd', v_row.tool_cost_usd,
    'toolCostCount', v_row.tool_cost_count,
    'status', case
      when v_row.completed_count = 0 then 'none'
      when v_row.unpriced_seconds = 0 then 'priced'
      when v_row.priced_seconds = 0 then 'none'
      else 'partial'
    end
  );
end;
$$;

create or replace function public.bwf_development_cost_save_rate(
  p_hourly_rate numeric,
  p_effective_from date,
  p_reason text,
  p_expected_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision bigint;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  perform public.bwf_assert_platform_admin();
  if p_hourly_rate is null or p_hourly_rate <= 0 then
    raise exception 'rate_invalid' using errcode = '22023';
  end if;
  if p_effective_from is null then
    raise exception 'effective_from_required' using errcode = '22023';
  end if;
  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'reason_invalid' using errcode = '22023';
  end if;

  select current_revision into v_revision
  from public.bwf_development_cost_settings
  where setting_key = 'app_development_hourly_rate'
  for update;

  if v_revision is distinct from p_expected_revision then
    raise exception 'revision_conflict' using errcode = '40001';
  end if;

  select coalesce(nullif(btrim(display_name), ''), v_email) into v_name
  from public.platform_user_profiles
  where lower(email) = v_email
  limit 1;
  v_name := coalesce(v_name, v_email);

  v_revision := v_revision + 1;

  insert into public.bwf_development_hourly_rate_versions (
    revision_no, effective_from, hourly_rate_hkd, change_reason,
    created_by_auth_user_id, created_by_name, created_by_email
  ) values (
    v_revision, p_effective_from, round(p_hourly_rate, 2), v_reason,
    auth.uid(), v_name, v_email
  );

  update public.bwf_development_cost_settings
  set current_revision = v_revision,
      updated_at = timezone('utc', now()),
      updated_by_auth_user_id = auth.uid()
  where setting_key = 'app_development_hourly_rate';

  return jsonb_build_object('revision', v_revision);
end;
$$;

revoke all on function public.bwf_dev_command_logs_list(date, date, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.bwf_dev_command_logs_analytics(date, date, text) from public, anon;
revoke all on function public.bwf_dev_command_log_delete(uuid) from public, anon;
revoke all on function public.bwf_development_cost_overview() from public, anon;
revoke all on function public.bwf_development_cost_span(date, date) from public, anon, authenticated;
revoke all on function public.bwf_development_cost_save_rate(numeric, date, text, bigint) from public, anon;
revoke all on function public.bwf_dev_command_log_start(text, text, text, text) from public, anon, authenticated;
revoke all on function public.bwf_dev_command_log_complete(uuid, text, text, bigint, bigint, bigint, numeric, numeric, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.bwf_dev_command_logs_list(date, date, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.bwf_dev_command_logs_analytics(date, date, text) to authenticated;
grant execute on function public.bwf_dev_command_log_delete(uuid) to authenticated;
grant execute on function public.bwf_development_cost_overview() to authenticated;
grant execute on function public.bwf_development_cost_save_rate(numeric, date, text, bigint) to authenticated;
grant execute on function public.bwf_dev_command_log_start(text, text, text, text) to service_role;
grant execute on function public.bwf_dev_command_log_complete(uuid, text, text, bigint, bigint, bigint, numeric, numeric, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
