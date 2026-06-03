-- ============================================================================
-- product_category — 產品分類登記（一級分類 / 二級分類）
-- 來源：FDS Product 分類 Excel，可於設定 > 產品分類頁面導入與編輯
-- ============================================================================
CREATE TABLE IF NOT EXISTS product_category (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 一級分類（例如 工作臺、辦公椅）
  level1 TEXT NOT NULL,
  -- 二級分類（例如 辦公桌、老闆枱）
  level2 TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_category_sort ON product_category(sort_order);

ALTER TABLE product_category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to product_category" ON product_category;
CREATE POLICY "Allow all access to product_category"
  ON product_category FOR ALL USING (true) WITH CHECK (true);

-- Seed from the provided Excel (idempotent: only seeds when table is empty)
INSERT INTO product_category (level1, level2, sort_order)
SELECT * FROM (VALUES
  ('工作臺', '辦公桌', 0),
  ('工作臺', '老闆枱', 1),
  ('工作臺', '升降桌', 2),
  ('工作臺', '培訓桌', 3),
  ('會議桌', '會議桌', 4),
  ('辦公椅', '會議椅', 5),
  ('辦公椅', '員工椅', 6),
  ('辦公椅', '洽談椅、休閑椅', 7),
  ('辦公椅', '培訓椅', 8),
  ('辦公椅', '大班椅', 9),
  ('會客區、接待區', '靜音倉、電話亭', 10),
  ('會客區、接待區', '前台', 11),
  ('儲物櫃', '文件櫃', 12),
  ('儲物櫃', '活動櫃', 13),
  ('儲物櫃', '鋼櫃', 14),
  ('休閑家具', '洽談桌', 15),
  ('休閑家具', '茶几', 16),
  ('休閑家具', '沙發', 17),
  ('休閑家具', '吧台、吧椅', 18),
  ('休閑家具', '戶外休閑家具', 19),
  ('醫養家具', '排椅', 20),
  ('醫養家具', '輸液沙發', 21),
  ('醫養家具', '醫療床', 22),
  ('餐飲家具', '餐桌', 23),
  ('餐飲家具', '餐椅', 24),
  ('學校家具', '書櫃', 25),
  ('學校家具', '書桌', 26),
  ('學校家具', '書椅', 27),
  ('實驗室家具', '理化枱', 28),
  ('實驗室家具', '醫療櫃', 29)
) AS seed(level1, level2, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM product_category);
