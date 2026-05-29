-- ============================================================================
-- Fix: Convert shopify_product_id UNIQUE INDEX to UNIQUE CONSTRAINT
-- The sync-from-shopify edge function uses:
--   .upsert(payload, { onConflict: "shopify_product_id" })
-- PostgREST requires a proper UNIQUE CONSTRAINT (not just a unique index)
-- for onConflict to work. The existing partial unique index doesn't qualify.
-- ============================================================================

-- Step 1: Drop the old partial unique index
DROP INDEX IF EXISTS idx_products_shopify_product_id;

-- Step 2: Add a proper UNIQUE CONSTRAINT on shopify_product_id
-- This allows PostgREST's onConflict: "shopify_product_id" to work
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopify_product_id_key;
ALTER TABLE products ADD CONSTRAINT products_shopify_product_id_key UNIQUE (shopify_product_id);

-- Step 3: Ensure the id column can handle the shopify-{id} format (already TEXT, but ensure no length issues)
-- No change needed, TEXT is unbounded

-- Step 4: Add any columns the sync function references that might be missing
-- (belt-and-suspenders approach — IF NOT EXISTS makes these safe to re-run)
ALTER TABLE products ADD COLUMN IF NOT EXISTS description_html TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_product_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE products ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_synced_data JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10,2);

-- Step 5: Ensure product_variants table has the right structure
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS inventory INTEGER NOT NULL DEFAULT 0;

-- Step 6: Ensure RLS policies exist for service role access
DROP POLICY IF EXISTS "Allow all access to products" ON products;
CREATE POLICY "Allow all access to products" ON products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to product_variants" ON product_variants;
CREATE POLICY "Allow all access to product_variants" ON product_variants FOR ALL USING (true) WITH CHECK (true);

-- Step 7: Recreate index for status lookups (non-unique, for query perf)
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_source ON products(source);
CREATE INDEX IF NOT EXISTS idx_products_title ON products(title);
