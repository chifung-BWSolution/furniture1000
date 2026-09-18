-- Link products to product_category via UUID FK.
-- Keep level1_category / level2_category as denormalized names so existing
-- filters and UIs keep working. A trigger is the source of truth for sync.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS product_category_id UUID
    REFERENCES public.product_category(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_product_category_id
  ON public.products (product_category_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_category_level1_level2_uidx
  ON public.product_category (btrim(level1), btrim(level2));

COMMENT ON COLUMN public.products.product_category_id IS
  'FK to product_category.id. level1_category / level2_category stay as denormalized names.';

-- Resolve L1+L2 text (plus the 會議桌/會議桌 alias) to a registry UUID.
CREATE OR REPLACE FUNCTION public.resolve_product_category_id(
  p_level1 TEXT,
  p_level2 TEXT
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH canon AS (
    SELECT
      CASE
        WHEN btrim(coalesce(p_level1, '')) = '會議桌'
         AND btrim(coalesce(p_level2, '')) = '會議桌'
          THEN '辦公枱'
        ELSE nullif(btrim(coalesce(p_level1, '')), '')
      END AS level1,
      CASE
        WHEN btrim(coalesce(p_level1, '')) = '會議桌'
         AND btrim(coalesce(p_level2, '')) = '會議桌'
          THEN '會議枱'
        ELSE nullif(btrim(coalesce(p_level2, '')), '')
      END AS level2
  )
  SELECT c.id
  FROM public.product_category c
  CROSS JOIN canon
  WHERE canon.level1 IS NOT NULL
    AND canon.level2 IS NOT NULL
    AND btrim(c.level1) = canon.level1
    AND btrim(c.level2) = canon.level2
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.sync_products_product_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_l1 TEXT;
  v_l2 TEXT;
  v_fk UUID;
  l1_changed BOOLEAN := false;
  l2_changed BOOLEAN := false;
  fk_changed BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    l1_changed := OLD.level1_category IS DISTINCT FROM NEW.level1_category;
    l2_changed := OLD.level2_category IS DISTINCT FROM NEW.level2_category;
    fk_changed := OLD.product_category_id IS DISTINCT FROM NEW.product_category_id;
  END IF;

  -- FK-only change (or INSERT with FK): names follow the registry row.
  IF NEW.product_category_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR (fk_changed AND NOT l1_changed AND NOT l2_changed)) THEN
    SELECT btrim(level1), btrim(level2)
      INTO v_l1, v_l2
    FROM public.product_category
    WHERE id = NEW.product_category_id;
    IF FOUND THEN
      NEW.level1_category := v_l1;
      NEW.level2_category := v_l2;
    ELSE
      NEW.product_category_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Text change, or INSERT without FK: resolve UUID from the pair.
  IF TG_OP = 'INSERT' OR l1_changed OR l2_changed OR NEW.product_category_id IS NULL THEN
    v_fk := public.resolve_product_category_id(NEW.level1_category, NEW.level2_category);
    NEW.product_category_id := v_fk;
    IF v_fk IS NOT NULL THEN
      SELECT btrim(level1), btrim(level2)
        INTO v_l1, v_l2
      FROM public.product_category
      WHERE id = v_fk;
      NEW.level1_category := v_l1;
      NEW.level2_category := v_l2;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_products_product_category ON public.products;
CREATE TRIGGER trg_sync_products_product_category
  BEFORE INSERT OR UPDATE OF product_category_id, level1_category, level2_category
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_products_product_category();

-- When a registry pair is renamed, refresh denormalized names on linked products.
CREATE OR REPLACE FUNCTION public.sync_products_from_product_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.level1 IS DISTINCT FROM OLD.level1
     OR NEW.level2 IS DISTINCT FROM OLD.level2 THEN
    UPDATE public.products
    SET
      level1_category = btrim(NEW.level1),
      level2_category = btrim(NEW.level2)
    WHERE product_category_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_products_from_product_category ON public.product_category;
CREATE TRIGGER trg_sync_products_from_product_category
  AFTER UPDATE OF level1, level2
  ON public.product_category
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_products_from_product_category();

-- 1) Exact L1+L2 matches
UPDATE public.products p
SET product_category_id = c.id
FROM public.product_category c
WHERE p.product_category_id IS NULL
  AND nullif(btrim(coalesce(p.level1_category, '')), '') IS NOT NULL
  AND nullif(btrim(coalesce(p.level2_category, '')), '') IS NOT NULL
  AND btrim(p.level1_category) = btrim(c.level1)
  AND btrim(p.level2_category) = btrim(c.level2);

-- 2) Legacy 會議桌 / 會議桌 → 辦公枱 / 會議枱
UPDATE public.products
SET
  product_category_id = '016c2781-7f1a-4aaf-a95f-10816dc19607',
  level1_category = '辦公枱',
  level2_category = '會議枱'
WHERE btrim(coalesce(level1_category, '')) = '會議桌'
  AND btrim(coalesce(level2_category, '')) = '會議桌';

-- 3) Explicit one-off: pajhsd8r4tl → 辦公枱 / 升降枱
UPDATE public.products
SET product_category_id = '8a73215f-57c9-40b8-aa70-d122e86f6af4'
WHERE id = 'pajhsd8r4tl';
