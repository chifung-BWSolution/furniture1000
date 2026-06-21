-- 「產品信息」頁可編輯欄位需要同步到 ready_to_shopify。
-- ready_to_shopify 已有 sku / price / tags / product_type，本檔補上尺寸與送貨資訊欄位，
-- 並從 products 回填現有資料。所有操作皆 idempotent。

-- 1. 新增欄位（若不存在）
alter table public.ready_to_shopify
  add column if not exists dimension_l_mm integer,
  add column if not exists dimension_w_mm integer,
  add column if not exists dimension_h_mm integer,
  add column if not exists in_stock       boolean,
  add column if not exists customize      text;

-- 2. 從 products 回填現有資料（product_id ↔ products.id）
--    sku / price 以 products 為準；尺寸、送貨資訊、分類同步。
update public.ready_to_shopify rts
set
  sku            = coalesce(p.sku, p.model, rts.sku),
  price          = coalesce(p.sale_price, p.price, rts.price),
  dimension_l_mm = p.dimension_l_mm,
  dimension_w_mm = p.dimension_w_mm,
  dimension_h_mm = p.dimension_h_mm,
  in_stock       = p.in_stock,
  customize      = p.customize,
  product_type   = coalesce(
                     nullif(concat_ws(' / ', nullif(p.level1_category, ''), nullif(p.level2_category, '')), ''),
                     rts.product_type
                   ),
  tags           = coalesce(p.tags, rts.tags)
from public.products p
where rts.product_id = p.id;
