-- FDS 2.1 Day 2（T-201～T-205）：逐頁提取結果、頁面分類、語意分段、分批續跑。
-- Edge 每次請求 CPU 很短，parse_pdf 會分批處理：每批後 checkpoint 回到 queued，
-- 進度存在 processing_jobs.payload->'state'，重試時從斷點續跑。

create table if not exists public.supplier_document_segments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.supplier_documents(id) on delete cascade,
  job_id uuid references public.processing_jobs(id) on delete set null,
  seq int not null check (seq >= 1),
  start_page int not null check (start_page >= 1),
  end_page int not null,
  kind text not null default 'other'
    check (kind in ('cover', 'toc', 'product', 'price_table', 'terms', 'other')),
  title text,
  page_types text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint supplier_document_segments_range check (end_page >= start_page),
  unique (document_id, seq)
);

create table if not exists public.supplier_document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.supplier_documents(id) on delete cascade,
  job_id uuid references public.processing_jobs(id) on delete set null,
  page_no int not null check (page_no >= 1),
  text_source text not null default 'none' check (text_source in ('text', 'ocr', 'none')),
  content text not null default '',
  char_count int not null default 0 check (char_count >= 0),
  image_count int not null default 0 check (image_count >= 0),
  ocr_status text not null default 'not_needed'
    check (ocr_status in ('not_needed', 'done', 'failed', 'skipped', 'unsupported')),
  ocr_error text,
  page_type text check (page_type in ('cover', 'toc', 'product', 'price_table', 'terms', 'other')),
  page_title text,
  continues_previous boolean,
  classify_confidence numeric check (classify_confidence is null or (classify_confidence >= 0 and classify_confidence <= 1)),
  segment_id uuid references public.supplier_document_segments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, page_no)
);

create index if not exists supplier_document_pages_segment_idx
  on public.supplier_document_pages (segment_id);

alter table public.supplier_document_segments enable row level security;
alter table public.supplier_document_pages enable row level security;
revoke all on public.supplier_document_segments from public, anon, authenticated;
revoke all on public.supplier_document_pages from public, anon, authenticated;
grant select on public.supplier_document_segments to authenticated;
grant select on public.supplier_document_pages to authenticated;
grant all on public.supplier_document_segments to service_role;
grant all on public.supplier_document_pages to service_role;

drop policy if exists "supplier_document_segments_read_admin_uploader" on public.supplier_document_segments;
create policy "supplier_document_segments_read_admin_uploader"
  on public.supplier_document_segments for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists "supplier_document_pages_read_admin_uploader" on public.supplier_document_pages;
create policy "supplier_document_pages_read_admin_uploader"
  on public.supplier_document_pages for select to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

-- Batch finished but work remains: back to the queue right away. A continuation is
-- not a failed attempt, so the attempt counter is handed back.
create or replace function public.fds_processing_job_checkpoint(
  p_job_id uuid,
  p_state jsonb,
  p_progress numeric default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.processing_jobs
  set payload = payload || jsonb_build_object('state', coalesce(p_state, '{}'::jsonb)),
      progress = coalesce(least(greatest(p_progress, 0), 1), progress),
      status = 'queued',
      run_after = now(),
      attempts = greatest(attempts - 1, 0),
      heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id and status = 'running';
  return found;
end;
$$;

-- Segments = runs of pages where each page continues the previous one.
create or replace function public.fds_supplier_document_build_segments(
  p_document_id uuid,
  p_job_id uuid default null
) returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.supplier_document_pages set segment_id = null where document_id = p_document_id;
  delete from public.supplier_document_segments where document_id = p_document_id;

  with numbered as (
    select
      p.page_no,
      coalesce(p.page_type, 'other') as page_type,
      p.page_title,
      sum(case when p.continues_previous is true and p.page_no > 1 then 0 else 1 end)
        over (order by p.page_no) as seq
    from public.supplier_document_pages p
    where p.document_id = p_document_id
  ),
  grouped as (
    select
      n.seq,
      min(n.page_no) as start_page,
      max(n.page_no) as end_page,
      mode() within group (order by n.page_type) as kind,
      (array_agg(n.page_title order by n.page_no) filter (where coalesce(n.page_title, '') <> ''))[1] as title,
      array_agg(distinct n.page_type) as page_types
    from numbered n
    group by n.seq
  )
  insert into public.supplier_document_segments (document_id, job_id, seq, start_page, end_page, kind, title, page_types)
  select p_document_id, p_job_id, g.seq, g.start_page, g.end_page, g.kind, left(g.title, 300), g.page_types
  from grouped g;

  get diagnostics v_count = row_count;

  update public.supplier_document_pages p
  set segment_id = s.id, updated_at = now()
  from public.supplier_document_segments s
  where s.document_id = p_document_id
    and p.document_id = p_document_id
    and p.page_no between s.start_page and s.end_page;

  return v_count;
end;
$$;

revoke all on function public.fds_processing_job_checkpoint(uuid, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.fds_supplier_document_build_segments(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fds_processing_job_checkpoint(uuid, jsonb, numeric) to service_role;
grant execute on function public.fds_supplier_document_build_segments(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
