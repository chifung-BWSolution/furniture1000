-- Add Shopify metafield columns to shopify_products
--
-- Source: Shopify product metafield definitions (ownerType: PRODUCT) for
-- brandingworks-office.myshopify.com, fetched via Admin GraphQL API.
-- Each column is named after the metafield's namespace.key (kept verbatim,
-- quoted, so the dot is preserved) so product matching & upload to Shopify
-- can map 1:1 between DB column and Shopify metafield.
--
-- All values stored as text (Shopify metafield .value is always a string,
-- including url / multi_line_text_field / string / list types).
--
-- A raw `metafields` jsonb column is also kept for any future / unknown keys.

ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS metafields jsonb,
  -- my_fields namespace
  ADD COLUMN IF NOT EXISTS "my_fields.recommend_size"      text,
  ADD COLUMN IF NOT EXISTS "my_fields.normal_size"         text,
  ADD COLUMN IF NOT EXISTS "my_fields.materials"           text,
  ADD COLUMN IF NOT EXISTS "my_fields.production_time"     text,
  ADD COLUMN IF NOT EXISTS "my_fields.more_recommend_size" text,
  ADD COLUMN IF NOT EXISTS "my_fields.image_alt"           text,
  ADD COLUMN IF NOT EXISTS "my_fields.image_link"          text,
  ADD COLUMN IF NOT EXISTS "my_fields.video_link"          text,
  -- custom namespace
  ADD COLUMN IF NOT EXISTS "custom.more_image_link_1"      text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_alt_1"       text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_link_2"      text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_alt_2"       text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_link_3"      text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_alt_3"       text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_link_4"      text,
  ADD COLUMN IF NOT EXISTS "custom.more_image_alt_4"       text,
  -- shopify standard namespace
  ADD COLUMN IF NOT EXISTS "shopify.color-pattern"         text;
