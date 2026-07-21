-- ready_to_shopify: extras live in images[] only (image_url = primary).
-- Merge legacy image_url_2 / image_url_3 into images[], then drop those columns.

DO $$
DECLARE
  r RECORD;
  new_images jsonb;
  extra_url text;
  existing_src text;
  pos int;
  found boolean;
BEGIN
  FOR r IN
    SELECT id, image_url, image_url_2, image_url_3, images
    FROM public.ready_to_shopify
    WHERE (image_url_2 IS NOT NULL AND btrim(image_url_2) <> '')
       OR (image_url_3 IS NOT NULL AND btrim(image_url_3) <> '')
  LOOP
    new_images := COALESCE(r.images, '[]'::jsonb);
    IF jsonb_typeof(new_images) <> 'array' THEN
      new_images := '[]'::jsonb;
    END IF;

    FOREACH extra_url IN ARRAY ARRAY[r.image_url_2, r.image_url_3] LOOP
      IF extra_url IS NULL OR btrim(extra_url) = '' THEN
        CONTINUE;
      END IF;
      IF r.image_url IS NOT NULL AND btrim(extra_url) = btrim(r.image_url) THEN
        CONTINUE;
      END IF;

      found := false;
      FOR existing_src IN
        SELECT btrim(COALESCE(elem->>'src', elem->>'url', ''))
        FROM jsonb_array_elements(new_images) AS elem
      LOOP
        IF existing_src = btrim(extra_url) THEN
          found := true;
          EXIT;
        END IF;
      END LOOP;

      IF NOT found THEN
        pos := jsonb_array_length(new_images) + 1;
        new_images := new_images || jsonb_build_array(
          jsonb_build_object('src', btrim(extra_url), 'position', pos)
        );
      END IF;
    END LOOP;

    UPDATE public.ready_to_shopify
    SET images = NULLIF(new_images, '[]'::jsonb),
        image_url_2 = NULL,
        image_url_3 = NULL
    WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.ready_to_shopify
  DROP COLUMN IF EXISTS image_url_2,
  DROP COLUMN IF EXISTS image_url_3;

-- Recreate image migration RPCs without image_url_2 / image_url_3.

DROP FUNCTION IF EXISTS public.get_rts_image_migration_batch(integer);
DROP FUNCTION IF EXISTS public.rts_row_needs_image_migration(text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.rts_row_needs_image_migration(
  p_image_url text,
  p_images jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    (COALESCE(p_image_url, '') LIKE 'data:%')
    OR (p_image_url IS NOT NULL AND p_image_url NOT LIKE 'http%' AND length(p_image_url) > 100)
    OR (COALESCE(p_images::text, '') LIKE '%data:image%');
$$;

CREATE OR REPLACE FUNCTION public.get_rts_image_migration_batch(p_limit integer DEFAULT 10)
RETURNS TABLE(
  product_id text,
  image_url text,
  images jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    r.product_id,
    r.image_url,
    r.images
  FROM public.ready_to_shopify r
  WHERE public.rts_row_needs_image_migration(r.image_url, r.images)
  ORDER BY r.product_id
  LIMIT greatest(1, least(COALESCE(p_limit, 10), 10));
$$;

CREATE OR REPLACE FUNCTION public.get_rts_image_migration_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::integer
  FROM public.ready_to_shopify r
  WHERE public.rts_row_needs_image_migration(r.image_url, r.images);
$$;

GRANT EXECUTE ON FUNCTION public.rts_row_needs_image_migration(text, jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rts_image_migration_batch(integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_rts_image_migration_count() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
