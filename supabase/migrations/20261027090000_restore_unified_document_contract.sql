-- Restore the V2.2 contract overwritten by the later catalog reconciliation.
-- Keep the legacy metadata-free RPC and child documents compatible; metadata
-- uploads remain validated by the existing ten-argument create RPC.
-- Restore inheritance and route uploads through processing_jobs, not the old queue.

alter table public.supplier_documents drop constraint if exists supplier_documents_catalog_meta_chk;
alter table public.supplier_documents add constraint supplier_documents_catalog_meta_chk check (
  parent_document_id is not null or document_year is null or (
    document_year between 1990 and 2100 and (
      doc_type <> 'catalog' or (
        length(btrim(coalesce(series, ''))) > 0 and cardinality(product_categories) > 0
      )
    )
  )
);

create or replace function public.force_supplier_catalog_pending()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.processing_status := case when new.doc_type = 'certificate' then 'not_applicable' else 'pending' end;
  if new.parent_document_id is not null then
    select d.document_year, d.series, d.product_categories, d.version_label, d.description
    into new.document_year, new.series, new.product_categories, new.version_label, new.description
    from public.supplier_documents d where d.id = new.parent_document_id;
  end if;
  return new;
end;
$$;

-- Preserve older direct-upload clients while pointing their jobs at the real worker.
create or replace function public.enqueue_supplier_catalog_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.doc_type in ('catalog', 'price_list') and new.parent_document_id is null
    and new.source = 'upload' then
    perform public.fds_supplier_document_enqueue_parse(new.id);
  end if;
  return new;
end;
$$;
