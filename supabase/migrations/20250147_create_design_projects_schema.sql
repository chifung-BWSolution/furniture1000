-- ============================================================================
-- Design Projects schema — 傢俬方案 (Furniture Scheme) + 客戶專區 (Client Zone)
-- Tables: design_projects, project_zones, zone_products,
--         project_invitations, client_companies, product_discussions
-- ============================================================================

-- ---------------------------------------------------------------------------
-- design_projects — 設計專案
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS design_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_name TEXT,
  client_company TEXT,
  -- 平面圖檔案 URL（PDF/JPG/PNG）
  floor_plan_url TEXT,
  floor_plan_type TEXT,
  -- 'draft' | 'in_progress' | 'confirmed' | 'archived'
  status TEXT NOT NULL DEFAULT 'draft',
  -- 進行中的方案版本標籤（例如 'A' / 'B'）
  active_scheme TEXT NOT NULL DEFAULT 'A',
  -- 整體確認進度 0-100
  progress INTEGER NOT NULL DEFAULT 0,
  -- 任意延伸資料（版本快照、AI 建議等）
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- project_zones — 分區（AI 自動建議 / 手動拖拉編輯）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  -- 分區代號（例如 B1 / M1）
  code TEXT,
  name TEXT NOT NULL,
  -- 平面圖上的範圍框 { x, y, w, h }（百分比）
  bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 是否由 AI 建議產生
  ai_suggested BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- zone_products — 分區內分配的產品（支援多方案 A/B）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zone_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  zone_id UUID REFERENCES project_zones(id) ON DELETE SET NULL,
  -- 對應 products 表（弱關聯，避免跨表硬依賴）
  product_id TEXT,
  product_title TEXT,
  product_image_url TEXT,
  sale_price NUMERIC,
  -- 方案標籤：'A' / 'B'
  scheme TEXT NOT NULL DEFAULT 'A',
  -- 狀態：'confirmed' 已確定 / 'discussing' 待討論 / 'pending' 未確定
  status TEXT NOT NULL DEFAULT 'pending',
  quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- project_invitations — 邀請客戶（純連結 / email）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  -- 'link' 純連結 / 'email'
  channel TEXT NOT NULL DEFAULT 'link',
  email TEXT,
  -- 無登入分享 token
  share_token TEXT UNIQUE NOT NULL,
  -- 'sent' 已發送 / 'viewed' 已查看 / 'revoked' 已撤銷
  status TEXT NOT NULL DEFAULT 'sent',
  viewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- client_companies — 客戶公司資料
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  -- 待審核的修改提案 { field: value }
  pending_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- product_discussions — 產品討論區留言（客戶 ↔ PM / 設計師）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_discussions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
  zone_product_id UUID REFERENCES zone_products(id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  -- 'pm' | 'designer' | 'client'
  author_role TEXT NOT NULL DEFAULT 'client',
  body TEXT NOT NULL,
  -- 被 @ 提及的對象
  mentions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_zones_project ON project_zones(project_id);
CREATE INDEX IF NOT EXISTS idx_zone_products_project ON zone_products(project_id);
CREATE INDEX IF NOT EXISTS idx_zone_products_zone ON zone_products(zone_id);
CREATE INDEX IF NOT EXISTS idx_invitations_project ON project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON project_invitations(share_token);
CREATE INDEX IF NOT EXISTS idx_discussions_project ON product_discussions(project_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — follow existing project convention (Allow all)
-- ---------------------------------------------------------------------------
ALTER TABLE design_projects     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_zones       ENABLE ROW LEVEL SECURITY;
ALTER TABLE zone_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_companies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_discussions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to design_projects" ON design_projects;
CREATE POLICY "Allow all access to design_projects" ON design_projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to project_zones" ON project_zones;
CREATE POLICY "Allow all access to project_zones" ON project_zones FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to zone_products" ON zone_products;
CREATE POLICY "Allow all access to zone_products" ON zone_products FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to project_invitations" ON project_invitations;
CREATE POLICY "Allow all access to project_invitations" ON project_invitations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to client_companies" ON client_companies;
CREATE POLICY "Allow all access to client_companies" ON client_companies FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all access to product_discussions" ON product_discussions;
CREATE POLICY "Allow all access to product_discussions" ON product_discussions FOR ALL USING (true) WITH CHECK (true);
