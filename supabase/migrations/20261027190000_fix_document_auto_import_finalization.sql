create or replace function public.fds_auto_import_clear_extractions(
  p_document_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approved int := 0;
  v_import jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'permission_denied' using errcode = '42501';
  end if;

  -- Serialize finalization for split documents and never import a partial parent.
  perform 1 from public.supplier_documents where id = p_document_id for update;
  if exists (
    select 1 from public.supplier_documents c
    where c.parent_document_id = p_document_id and c.status not in ('review', 'ready')
  ) then
    return jsonb_build_object('waiting_for_parts', true);
  end if;

  -- Compare all extracted rows before any are approved, including rows produced
  -- by different structure batches or merged from different PDF parts.
  with priced as (
    select e.id,
      public.fds_model_key(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model')) as model_key,
      upper(coalesce(nullif(coalesce(e.corrected_json ->> 'currency', e.raw_json ->> 'currency'), ''), d.currency, '')) as currency,
      coalesce(e.corrected_json ->> 'unit', e.raw_json ->> 'unit', '') as unit,
      public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')) as price
    from public.extraction_items e
    join public.supplier_documents d on d.id = e.document_id
    where e.document_id = p_document_id and e.status = 'pending'
      and e.imported_product_id is null
  ), conflicts as (
    select model_key, currency, unit from priced
    where model_key <> '' and price is not null
    group by model_key, currency, unit having count(distinct price) > 1
  )
  update public.extraction_items e
  set needs_attention = true,
      flags = array_append(coalesce(e.flags, '{}'::text[]), 'price_year_conflict'),
      updated_at = now()
  from priced p join conflicts c using (model_key, currency, unit)
  where e.id = p.id and not ('price_year_conflict' = any(coalesce(e.flags, '{}'::text[])));

  update public.extraction_items e
  set status = 'approved',
      review_note = coalesce(e.review_note, 'auto_imported'),
      reviewed_at = now(),
      updated_at = now()
  where e.document_id = p_document_id
    and e.status = 'pending'
    and e.needs_attention = false
    and e.imported_product_id is null
    and nullif(btrim(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model', '')), '') is not null
    and not (e.flags && array[
      'missing_model', 'missing_price', 'price_not_in_source', 'price_year_conflict',
      'color_unmapped', 'low_confidence', 'dimension_suspicious', 'currency_missing'
    ]::text[]);
  get diagnostics v_approved = row_count;

  perform set_config('fds.import_actor', 'worker', true);
  v_import := public.fds_import_extracted_products(p_document_id);

  return v_import || jsonb_build_object('auto_approved', v_approved);
end;
$$;

revoke all on function public.fds_auto_import_clear_extractions(uuid) from public, anon, authenticated;
grant execute on function public.fds_auto_import_clear_extractions(uuid) to service_role;

notify pgrst, 'reload schema';

-- Finish the parent in the same transaction as the last completed child. A
-- failure rolls back job completion so the worker can retry instead of silently
-- leaving an unimported parent after the job has already finished.
create or replace function public.fds_auto_import_completed_parts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.parent_document_id is not null and new.status in ('review', 'ready')
     and old.status is distinct from new.status then
    perform public.fds_auto_import_clear_extractions(new.parent_document_id);
  end if;
  return new;
end;
$$;
revoke all on function public.fds_auto_import_completed_parts() from public, anon, authenticated;
drop trigger if exists zzz_fds_auto_import_completed_parts on public.supplier_documents;
create trigger zzz_fds_auto_import_completed_parts after update of status on public.supplier_documents
for each row execute function public.fds_auto_import_completed_parts();
