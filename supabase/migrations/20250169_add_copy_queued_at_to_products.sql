-- Track when a product most recently entered (or re-entered) the 產品文案 queue.
-- Updated when:
--   1. A product is first added to the Shopify queue (addToShopifyQueue).
--   2. A product is reverted from 產品信息 back to 產品文案.
-- Used to sort 產品文案 by most-recently-queued first.
ALTER TABLE products ADD COLUMN IF NOT EXISTS copy_queued_at TIMESTAMPTZ;

-- Back-fill: products already in the queue get a queued time equal to
-- copy_done_at (if set) or created_at as a reasonable approximation.
UPDATE products
SET copy_queued_at = COALESCE(copy_done_at, created_at)
WHERE in_shopify_queue = true AND copy_queued_at IS NULL;
