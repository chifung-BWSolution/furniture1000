-- Canva AI generation: allow generation_mode = 'ai' and store the design thumbnail.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'canva_design_sessions'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%generation_mode%'
  loop
    execute format('alter table public.canva_design_sessions drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.canva_design_sessions
  add constraint canva_design_sessions_generation_mode_check
  check (generation_mode is null or generation_mode in ('blank', 'autofill', 'ai'));

alter table public.canva_design_sessions
  add column if not exists thumbnail_url text;

comment on column public.canva_design_sessions.generation_mode is
  'blank = empty presentation; autofill = retired brand-template fill; ai = Canva design generation.';

comment on column public.canva_design_sessions.thumbnail_url is
  'Canva design thumbnail URL. Canva expires this URL about 15 minutes after it is issued.';

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
      'thumbnail_url', s.thumbnail_url,
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

revoke all on function public.fds_list_canva_design_sessions(int) from public, anon;
grant execute on function public.fds_list_canva_design_sessions(int) to authenticated;
