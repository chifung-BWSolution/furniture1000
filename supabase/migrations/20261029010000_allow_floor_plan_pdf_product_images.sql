-- Floor plans share the existing product-images bucket with product photos.
-- Preserve each environment's existing allowlist and unrestricted buckets.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/pdf')
where id = 'product-images'
  and allowed_mime_types is not null
  and not ('application/pdf' = any(allowed_mime_types));
