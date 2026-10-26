-- FDS V2.2 dropped supplier_documents SELECT while tightening who can open originals,
-- and did not put an admin/uploader policy back. The directory then had an upload
-- year from the service-role signal, but the browser could not read the PDF path.
-- Originals stay limited to admin/uploader (they can contain supplier cost).

drop policy if exists supplier_documents_select_staff on public.supplier_documents;
create policy supplier_documents_select_staff
  on public.supplier_documents
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
