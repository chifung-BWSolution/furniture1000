-- Simple verification: ensure table exists and seed data
CREATE TABLE IF NOT EXISTS bwf_product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES bwf_product_categories(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1, 2)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint if not exists (ignore error if already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_category_name_parent'
  ) THEN
    ALTER TABLE bwf_product_categories ADD CONSTRAINT unique_category_name_parent UNIQUE (name, parent_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bwf_product_categories_parent_id ON bwf_product_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_bwf_product_categories_level ON bwf_product_categories(level);
CREATE INDEX IF NOT EXISTS idx_bwf_product_categories_sort_order ON bwf_product_categories(sort_order);

DROP POLICY IF EXISTS "Allow all access to bwf_product_categories" ON bwf_product_categories;
ALTER TABLE bwf_product_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to bwf_product_categories" ON bwf_product_categories FOR ALL USING (true) WITH CHECK (true);

-- Clear and reseed
DELETE FROM bwf_product_categories WHERE level = 2;
DELETE FROM bwf_product_categories WHERE level = 1;

DO $$
DECLARE
  p_37_id UUID;
  p_desk_id UUID;
  p_office_chair_id UUID;
  p_meeting_id UUID;
  p_storage_id UUID;
  p_leisure_id UUID;
  p_partition_id UUID;
  p_dresser_id UUID;
  p_school_id UUID;
  p_medical_id UUID;
  p_industry_id UUID;
BEGIN
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('3-7天送貨', NULL, 1, 1) RETURNING id INTO p_37_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('辦公枱', NULL, 1, 2) RETURNING id INTO p_desk_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('辦公座椅', NULL, 1, 3) RETURNING id INTO p_office_chair_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('會議室', NULL, 1, 4) RETURNING id INTO p_meeting_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('儲物櫃', NULL, 1, 5) RETURNING id INTO p_storage_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('休閒家具', NULL, 1, 6) RETURNING id INTO p_leisure_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('間隔訂造', NULL, 1, 7) RETURNING id INTO p_partition_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('梳化茶几', NULL, 1, 8) RETURNING id INTO p_dresser_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('學校傢俬', NULL, 1, 9) RETURNING id INTO p_school_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('醫療科學', NULL, 1, 10) RETURNING id INTO p_medical_id;
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('行業傢俬', NULL, 1, 11) RETURNING id INTO p_industry_id;

  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('工作枱', p_37_id, 2, 1), ('行政枱', p_37_id, 2, 2), ('升降枱', p_37_id, 2, 3), ('會議枱', p_37_id, 2, 4), ('辦公椅', p_37_id, 2, 5), ('儲物櫃', p_37_id, 2, 6);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('開放工作枱', p_desk_id, 2, 1), ('屏風枱', p_desk_id, 2, 2), ('培訓枱', p_desk_id, 2, 3), ('升降枱', p_desk_id, 2, 4), ('行政枱', p_desk_id, 2, 5), ('前台接待櫃檯', p_desk_id, 2, 6), ('枱下活動櫃', p_desk_id, 2, 7), ('顯示器支架', p_desk_id, 2, 8);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('辦公椅', p_office_chair_id, 2, 1), ('大班椅', p_office_chair_id, 2, 2), ('皮款椅', p_office_chair_id, 2, 3), ('會客椅', p_office_chair_id, 2, 4), ('培訓椅', p_office_chair_id, 2, 5), ('休閒椅', p_office_chair_id, 2, 6), ('餐椅', p_office_chair_id, 2, 7), ('高腳椅', p_office_chair_id, 2, 8), ('禮堂椅', p_office_chair_id, 2, 9), ('疊椅', p_office_chair_id, 2, 10), ('電競椅', p_office_chair_id, 2, 11), ('設計師椅', p_office_chair_id, 2, 12);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('1-2人面談枱', p_meeting_id, 2, 1), ('4-6人會議枱', p_meeting_id, 2, 2), ('8-12人會議枱', p_meeting_id, 2, 3), ('12-18人會議枱', p_meeting_id, 2, 4), ('18以上超大會議枱', p_meeting_id, 2, 5), ('視像會議枱', p_meeting_id, 2, 6);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('文件木櫃', p_storage_id, 2, 1), ('文件制櫃', p_storage_id, 2, 2), ('櫃桶', p_storage_id, 2, 3), ('有鎖儲物櫃', p_storage_id, 2, 4), ('層架', p_storage_id, 2, 5), ('路軌櫃', p_storage_id, 2, 6), ('智能櫃', p_storage_id, 2, 7), ('訂造櫃', p_storage_id, 2, 8), ('裝飾櫃', p_storage_id, 2, 9), ('廚櫃', p_storage_id, 2, 10);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('接待家具', p_leisure_id, 2, 1), ('戶外傢俬', p_leisure_id, 2, 2), ('茶枱', p_leisure_id, 2, 3), ('裝飾傢俬', p_leisure_id, 2, 4), ('新中式家具', p_leisure_id, 2, 5);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('靜音倉', p_partition_id, 2, 1), ('屏風間隔', p_partition_id, 2, 2), ('會議室間隔', p_partition_id, 2, 3);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('單人梳化', p_dresser_id, 2, 1), ('兩人梳化', p_dresser_id, 2, 2), ('三人梳化', p_dresser_id, 2, 3), ('組合梳化', p_dresser_id, 2, 4), ('高背梳化', p_dresser_id, 2, 5), ('皮革梳化', p_dresser_id, 2, 6), ('布藝梳化', p_dresser_id, 2, 7), ('茶几', p_dresser_id, 2, 8), ('設計師梳化', p_dresser_id, 2, 9);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('幼兒園', p_school_id, 2, 1), ('中小學', p_school_id, 2, 2), ('圖書館', p_school_id, 2, 3), ('學生枱椅', p_school_id, 2, 4), ('學校辦公', p_school_id, 2, 5), ('學生宿舍床', p_school_id, 2, 6), ('科學室', p_school_id, 2, 7), ('STEAM', p_school_id, 2, 8), ('學校儲物櫃', p_school_id, 2, 9), ('老師教學桌', p_school_id, 2, 10);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('實驗理化枱', p_medical_id, 2, 1), ('護理床', p_medical_id, 2, 2), ('電動床', p_medical_id, 2, 3), ('急救車', p_medical_id, 2, 4);
  INSERT INTO bwf_product_categories (name, parent_id, level, sort_order) VALUES ('餐廳傢俬', p_industry_id, 2, 1), ('酒店傢俬', p_industry_id, 2, 2), ('安老院', p_industry_id, 2, 3), ('零售店傢俬(產品展示)', p_industry_id, 2, 4), ('醫療診所', p_industry_id, 2, 5), ('實驗室', p_industry_id, 2, 6), ('寵物傢俬', p_industry_id, 2, 7), ('美容院', p_industry_id, 2, 8), ('設計樓', p_industry_id, 2, 9);
END $$;
