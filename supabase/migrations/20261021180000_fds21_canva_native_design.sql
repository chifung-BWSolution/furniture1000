-- T-901: Canva native presentation sessions (not Design Imports / local PPTX).

create table if not exists public.canva_design_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.canva_design_sessions (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'creating', 'ready', 'exporting', 'exported', 'failed')),
  brief jsonb not null default '{}'::jsonb,
  product_ids text[] not null default '{}',
  canva_design_id text,
  edit_url text,
  view_url text,
  export_job_id text,
  export_download_url text,
  export_error text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists canva_design_sessions_staff_idx
  on public.canva_design_sessions (staff_id, created_at desc);

alter table public.canva_design_sessions enable row level security;

comment on table public.canva_design_sessions is
  'FDS 2.1 T-901 Canva native design briefs and design IDs. Writes via edge (service role).';

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

revoke all on table public.canva_design_sessions from public, anon, authenticated;
grant all on table public.canva_design_sessions to service_role;

revoke all on function public.fds_list_canva_design_sessions(int) from public, anon;
grant execute on function public.fds_list_canva_design_sessions(int) to authenticated;
