-- Add SEO/URL fields to ready_to_shopify for 產品文案 page
ALTER TABLE public.ready_to_shopify
  ADD COLUMN IF NOT EXISTS shopify_page_title text,
  ADD COLUMN IF NOT EXISTS shopify_page_description text,
  ADD COLUMN IF NOT EXISTS shopify_url text;
