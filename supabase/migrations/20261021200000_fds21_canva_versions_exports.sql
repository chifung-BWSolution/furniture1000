-- T-903: version chains, export audit (no PPTX bytes in DB).

alter table public.canva_design_sessions
  add column if not exists root_id uuid references public.canva_design_sessions (id) on delete set null,
  add column if not exists content_version int not null default 1,
  add column if not exists version_note text;

comment on column public.canva_design_sessions.root_id is
  'Version chain root session id (first draft in chain).';
comment on column public.canva_design_sessions.content_version is
  'Monotonic version number within root_id chain (T-903).';

update public.canva_design_sessions
set root_id = id
where root_id is null;

create table if not exists public.canva_design_exports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.canva_design_sessions (id) on delete cascade,
  staff_id uuid not null references auth.users (id) on delete cascade,
  format text not null check (format in ('pptx', 'pdf')),
  canva_design_id text not null,
  export_job_id text,
  download_url text,
  url_expires_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists canva_design_exports_session_idx
  on public.canva_design_exports (session_id, created_at desc);

alter table public.canva_design_exports enable row level security;

comment on table public.canva_design_exports is
  'T-903 Canva export audit; download URLs expire (~24h). No file blobs.';

revoke all on table public.canva_design_exports from public, anon, authenticated;
grant all on table public.canva_design_exports to service_role;

create or replace function public.fds_list_canva_design_sessions(p_limit int default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'parent_id', s.parent_id,
      'root_id', s.root_id,
      'content_version', s.content_version,
      'version_note', s.version_note,
      'status', s.status,
      'brief', s.brief,
      'product_ids', s.product_ids,
      'canva_design_id', s.canva_design_id,
      'edit_url', s.edit_url,
      'view_url', s.view_url,
      'export_job_id', s.export_job_id,
      'export_download_url', s.export_download_url,
      'export_error', s.export_error,
      'error', s.error,
      'generation_mode', s.generation_mode,
      'brand_template_id', s.brand_template_id,
      'autofill_job_id', s.autofill_job_id,
      'populate_report', s.populate_report,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    ) order by s.created_at desc)
    from (
      select *
      from public.canva_design_sessions
      where staff_id = auth.uid()
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 12), 50))
    ) s
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fds_list_canva_session_versions(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_root uuid;
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  select coalesce(s.root_id, s.id) into v_root
  from public.canva_design_sessions s
  where s.id = p_session_id and s.staff_id = auth.uid();
  if v_root is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'parent_id', s.parent_id,
      'root_id', s.root_id,
      'content_version', s.content_version,
      'version_note', s.version_note,
      'status', s.status,
      'canva_design_id', s.canva_design_id,
      'edit_url', s.edit_url,
      'created_at', s.created_at,
      'updated_at', s.updated_at
    ) order by s.content_version asc, s.created_at asc)
    from public.canva_design_sessions s
    where s.staff_id = auth.uid()
      and coalesce(s.root_id, s.id) = v_root
  ), '[]'::jsonb);
end;
$$;

create or replace function public.fds_list_canva_design_exports(p_session_id uuid, p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.bwf_assert_role(array['admin', 'uploader']);
  if not exists (
    select 1 from public.canva_design_sessions s
    where s.id = p_session_id and s.staff_id = auth.uid()
  ) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id,
      'format', e.format,
      'export_job_id', e.export_job_id,
      'download_url', e.download_url,
      'url_expires_at', e.url_expires_at,
      'error', e.error,
      'canva_design_id', e.canva_design_id,
      'created_at', e.created_at
    ) order by e.created_at desc)
    from (
      select *
      from public.canva_design_exports
      where session_id = p_session_id and staff_id = auth.uid()
      order by created_at desc
      limit greatest(1, least(coalesce(p_limit, 20), 50))
    ) e
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fds_list_canva_design_sessions(int) from public, anon;
grant execute on function public.fds_list_canva_design_sessions(int) to authenticated;

revoke all on function public.fds_list_canva_session_versions(uuid) from public, anon;
grant execute on function public.fds_list_canva_session_versions(uuid) to authenticated;

revoke all on function public.fds_list_canva_design_exports(uuid, int) from public, anon;
grant execute on function public.fds_list_canva_design_exports(uuid, int) to authenticated;
