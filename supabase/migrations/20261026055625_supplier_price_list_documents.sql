alter table public.supplier_documents
  drop constraint if exists supplier_documents_doc_type_check;

alter table public.supplier_documents
  add constraint supplier_documents_doc_type_check
  check (doc_type = any (array['quote', 'catalog', 'price_list', 'certificate']));

-- Price lists use the same document row and night queue as catalogs.
-- Catalog still requires series and product categories. A price list only requires a year.

alter table public.supplier_documents
  drop constraint if exists supplier_documents_catalog_meta_chk;

alter table public.supplier_documents
  add constraint supplier_documents_catalog_meta_chk
  check (
    doc_type not in ('catalog', 'price_list')
    or (
      document_year between 1990 and 2100
      and (
        doc_type <> 'catalog'
        or (
          length(btrim(coalesce(series, ''))) > 0
          and cardinality(product_categories) > 0
        )
      )
    )
  );

drop index if exists supplier_documents_catalog_hash_uidx;

create unique index if not exists supplier_documents_file_hash_uidx
  on public.supplier_documents (factory_id, doc_type, content_hash)
  where doc_type in ('catalog', 'price_list')
    and content_hash is not null
    and parent_document_id is null;

create or replace function public.force_supplier_catalog_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.doc_type in ('catalog', 'price_list') and new.parent_document_id is null then
    new.processing_status := 'pending';
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_supplier_catalog_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.doc_type in ('catalog', 'price_list') and new.parent_document_id is null then
    insert into public.supplier_document_jobs (document_id, status)
    values (new.id, 'pending');
  end if;
  return new;
end;
$$;

drop policy if exists supplier_documents_insert_catalog on public.supplier_documents;
create policy supplier_documents_insert_catalog
  on public.supplier_documents
  for insert
  to authenticated
  with check (
    public.bwf_has_role(array['admin', 'uploader'])
    and doc_type in ('catalog', 'price_list')
    and parent_document_id is null
    and processing_status = 'pending'
  );

notify pgrst, 'reload schema';
