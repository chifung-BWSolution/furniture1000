-- Older quotation lines were often imported with the product label in `category`
-- and an empty `name` (the old editor had a separate 類別 field). The editor and
-- PDF display fall back to `category`, but the blank `name` still leaves
-- 產品名稱 empty and breaks name-based lookups (e.g. product linking).
--
-- Backfill only product / value-added rows. Section titles and custom terms keep
-- their own naming semantics, and rows that already have a name are untouched.
-- Idempotent: re-running only affects rows that are still blank.
UPDATE public.bwf_quote_item AS i
SET name = btrim(i.category)
WHERE coalesce(btrim(i.name), '') = ''
  AND coalesce(btrim(i.category), '') <> ''
  AND btrim(i.category) !~ '^[—–-]+$'
  AND coalesce(i.is_section_title, false) = false
  AND coalesce(i.is_custom_term, false) = false;

COMMENT ON COLUMN public.bwf_quote_item.name IS
  '產品名稱。舊資料可能只填 category；載入時以 name 為先，空白才回退 category。';
