-- A quotation line may correct a catalog category without changing the product.
CREATE OR REPLACE FUNCTION public.sync_bwf_quote_item_product_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only supply a default for new lines. Explicit selections and updates win.
  IF TG_OP = 'INSERT' AND NEW.product_category_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT p.product_category_id INTO NEW.product_category_id
    FROM public.products p WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;
