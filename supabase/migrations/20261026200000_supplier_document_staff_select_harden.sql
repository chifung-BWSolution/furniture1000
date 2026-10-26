-- develop's 20261026103000_reconcile_supplier_catalog_schema.sql re-created broad
-- supplier_documents_select_staff / jobs / storage SELECT for designer+pm (cost PDFs).
-- Catalog-only designer/pm policies live in 20261026173000; this restores admin+uploader
-- staff SELECT without touching those catalog policies.

drop policy if exists supplier_documents_select_staff on public.supplier_documents;
create policy supplier_documents_select_staff
  on public.supplier_documents
  for select
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists supplier_document_jobs_select_staff on public.supplier_document_jobs;
create policy supplier_document_jobs_select_staff
  on public.supplier_document_jobs
  for select
  to authenticated
  using (public.bwf_has_role(array['admin', 'uploader']));

drop policy if exists supplier_documents_objects_select_staff on storage.objects;
create policy supplier_documents_objects_select_staff
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'supplier-documents'
    and public.bwf_has_role(array['admin', 'uploader'])
  );

notify pgrst, 'reload schema';
