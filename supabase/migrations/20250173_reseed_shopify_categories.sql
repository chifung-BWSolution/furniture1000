-- Reseed bwf_product_categories from the 0617 Shopify category list.
-- Safe to run multiple times (DELETE first, then re-insert).

DELETE FROM bwf_product_categories;

DO $$
DECLARE
  p1 UUID; p2 UUID; p3 UUID; p4 UUID;  p5 UUID;  p6 UUID;
  p7 UUID; p8 UUID; p9 UUID; p10 UUID; p11 UUID; p12 UUID;
BEGIN
  -- ── Level 1 (一級分類) ──────────────────────────────────────────
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('3-7天送貨',  NULL, 1,  1) RETURNING id INTO p1;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('辦公枱',    NULL, 1,  2) RETURNING id INTO p2;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('工作枱',    NULL, 1,  3) RETURNING id INTO p3;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('辦公座椅',  NULL, 1,  4) RETURNING id INTO p4;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('餐廳傢俬',  NULL, 1,  5) RETURNING id INTO p5;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('儲物櫃',    NULL, 1,  6) RETURNING id INTO p6;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('休閒家具',  NULL, 1,  7) RETURNING id INTO p7;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('接待家具',  NULL, 1,  8) RETURNING id INTO p8;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('靜音倉',    NULL, 1,  9) RETURNING id INTO p9;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('學校傢俬',  NULL, 1, 10) RETURNING id INTO p10;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('醫療科學',  NULL, 1, 11) RETURNING id INTO p11;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('行業傢俬',  NULL, 1, 12) RETURNING id INTO p12;

  -- ── Level 2 (二級分類) ──────────────────────────────────────────

  -- 3-7天送貨
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('3-7天送貨', p1, 2, 1);

  -- 辦公枱
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('辦公枱',        p2, 2, 1), ('工作枱',   p2, 2, 2), ('行政枱',    p2, 2, 3),
    ('升降枱',        p2, 2, 4), ('會議枱',   p2, 2, 5), ('培訓枱',    p2, 2, 6),
    ('前台接待櫃枱',  p2, 2, 7);

  -- 工作枱
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('開放工作枱', p3, 2, 1), ('屏風枱', p3, 2, 2);

  -- 辦公座椅
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('辦公座椅', p4, 2, 1), ('辦公椅', p4, 2, 2), ('大班椅',   p4, 2, 3),
    ('會客椅',   p4, 2, 4), ('培訓椅', p4, 2, 5), ('吧椅',     p4, 2, 6),
    ('禮堂椅',   p4, 2, 7), ('疊椅',   p4, 2, 8), ('電競椅',   p4, 2, 9),
    ('設計師椅', p4, 2, 10);

  -- 餐廳傢俬
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('餐廳傢俬', p5, 2, 1), ('餐枱', p5, 2, 2), ('餐椅',     p5, 2, 3),
    ('餐廳卡座', p5, 2, 4), ('電動餐枱', p5, 2, 5);

  -- 儲物櫃
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('儲物櫃',   p6, 2, 1), ('文件木櫃', p6, 2, 2), ('文件鋼櫃', p6, 2, 3),
    ('櫃桶',     p6, 2, 4), ('層架',     p6, 2, 5);

  -- 休閒家具
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('休閒家具',   p7, 2, 1), ('接待家具',   p7, 2, 2), ('戶外傢俬',   p7, 2, 3),
    ('茶枱',       p7, 2, 4), ('休閒椅',     p7, 2, 5), ('裝飾傢俬',   p7, 2, 6),
    ('新中式家具', p7, 2, 7);

  -- 接待家具
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('茶几', p8, 2, 1), ('梳化', p8, 2, 2);

  -- 靜音倉
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('靜音倉', p9, 2, 1);

  -- 學校傢俬
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('學校傢俬',   p10, 2, 1), ('幼兒園',     p10, 2, 2), ('中小學',     p10, 2, 3),
    ('圖書館',     p10, 2, 4), ('學生枱椅',   p10, 2, 5), ('學校辦公',   p10, 2, 6),
    ('學生宿舍床', p10, 2, 7);

  -- 醫療科學
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('實驗理化枱', p11, 2, 1), ('護理床', p11, 2, 2), ('急救車', p11, 2, 3);

  -- 行業傢俬
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES
    ('行業傢俬',     p12, 2,  1), ('政府及 NGO', p12, 2,  2), ('酒店傢俬',   p12, 2,  3),
    ('安老院',       p12, 2,  4), ('零售店傢俬', p12, 2,  5), ('醫療診所',   p12, 2,  6),
    ('實驗室',       p12, 2,  7), ('寵物傢俬',   p12, 2,  8), ('美容院',     p12, 2,  9),
    ('設計樓',       p12, 2, 10);
END $$;
