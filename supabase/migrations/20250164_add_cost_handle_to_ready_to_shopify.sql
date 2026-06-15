-- Add cost (from products.cost_price) and handle (SKU/URL handle) to ready_to_shopify.
ALTER TABLE public.ready_to_shopify
  ADD COLUMN IF NOT EXISTS cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS handle text;
