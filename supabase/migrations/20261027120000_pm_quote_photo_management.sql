-- PM can manage the quotation image library; retain all existing role access.
alter policy quote_photo_assets_insert on public.quote_photo_assets
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));
alter policy quote_photo_assets_update on public.quote_photo_assets
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']))
  with check (public.bwf_has_role(array['admin', 'uploader', 'pm']));
alter policy quote_photo_assets_delete on public.quote_photo_assets
  using (public.bwf_has_role(array['admin', 'uploader', 'pm']));

alter policy quote_photos_objects_insert on storage.objects
  with check (
    bucket_id = 'quote-photos'
    and name like 'library/%'
    and public.bwf_has_role(array['admin', 'uploader', 'pm'])
  );
alter policy quote_photos_objects_delete on storage.objects
  using (
    bucket_id = 'quote-photos'
    and public.bwf_has_role(array['admin', 'uploader', 'pm'])
  );
