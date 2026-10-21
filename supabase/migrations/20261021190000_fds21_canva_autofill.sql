-- T-902: Canva autofill generation metadata on design sessions.

alter table public.canva_design_sessions
  add column if not exists generation_mode text
    check (generation_mode is null or generation_mode in ('blank', 'autofill')),
  add column if not exists brand_template_id text,
  add column if not exists autofill_job_id text,
  add column if not exists populate_report jsonb;

comment on column public.canva_design_sessions.generation_mode is
  'blank = T-901 empty presentation; autofill = brand template dataset fill (T-902).';

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
