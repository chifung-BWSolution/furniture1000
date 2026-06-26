-- Fix Storage RLS for product-images bucket.
-- Browser uploads use the anon key (no Supabase Auth login), so policies must
-- allow both anon and authenticated roles. Missing policies caused:
--   "new row violates row-level security policy for table objects"
-- and cascading 544 errors on POST /object/product-images/...

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  52428800, -- 50 MB
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = COALESCE(storage.buckets.file_size_limit, EXCLUDED.file_size_limit);

-- Drop legacy policies if re-running
DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
DROP POLICY IF EXISTS "product-images anon insert" ON storage.objects;
DROP POLICY IF EXISTS "product-images anon update" ON storage.objects;
DROP POLICY IF EXISTS "product-images anon delete" ON storage.objects;
DROP POLICY IF EXISTS "product-images auth insert" ON storage.objects;
DROP POLICY IF EXISTS "product-images auth update" ON storage.objects;
DROP POLICY IF EXISTS "product-images auth delete" ON storage.objects;

CREATE POLICY "product-images public read"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'product-images');

CREATE POLICY "product-images anon insert"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images anon update"
  ON storage.objects FOR UPDATE
  TO anon
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images anon delete"
  ON storage.objects FOR DELETE
  TO anon
  USING (bucket_id = 'product-images');

CREATE POLICY "product-images auth insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images auth update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product-images auth delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'product-images');
