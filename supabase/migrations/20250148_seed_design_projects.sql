-- ============================================================================
-- Seed example data for 傢俬方案 / 客戶專區 pages.
-- Safe to re-run: uses fixed UUIDs + ON CONFLICT DO NOTHING.
-- ============================================================================

-- design_projects
INSERT INTO design_projects (id, name, client_name, client_company, status, active_scheme, progress, created_by, created_at, updated_at, meta) VALUES
  ('11111111-1111-1111-1111-111111111111', '伊利沙伯中學舊生會中學 課室及辦公傢俬', '黃智穎', '伊利沙伯中學舊生會中學', 'in_progress', 'A', 62, 'CF', '2026-05-12T09:00:00Z', '2026-07-21T09:00:00Z', '{"projectType":"school","pitchingCode":"BWF-SH26-060","quoteId":"BWF-SH26-060"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'HK PolyU Charlene Zhou 傢俬方案', 'Charlene Zhou', 'HK PolyU Charlene Zhou', 'confirmed', 'B', 100, 'CF', '2026-04-20T09:00:00Z', '2026-07-21T09:00:00Z', '{"projectType":"school","pitchingCode":"BWF-SH26-061","quoteId":"BWF-SH26-061"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', '仁濟醫院 診所傢俬配置', 'Yan Chai Hospital', '仁濟醫院', 'draft', 'A', 15, 'CF', '2026-05-30T09:00:00Z', '2026-07-21T09:00:00Z', '{"projectType":"clinic","pitchingCode":"BWF-SH26-058"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- project_zones
INSERT INTO project_zones (id, project_id, code, name, bounds, ai_suggested, sort_order) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'PR1', '校長室', '{"x":6,"y":8,"w":34,"h":40}', true, 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'C1', '課室', '{"x":46,"y":8,"w":30,"h":32}', true, 1),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'T1', '教員室', '{"x":6,"y":54,"w":70,"h":38}', true, 2)
ON CONFLICT (id) DO NOTHING;

-- zone_products (in-zone allocations)
INSERT INTO zone_products (id, project_id, zone_id, product_id, product_title, product_image_url, sale_price, scheme, status, quantity, sort_order) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'r54', '行政辦公桌 1.8m', 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=400&q=70', 4800, 'A', 'confirmed', 1, 0),
  ('bbbbbbbb-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'r55', '真皮行政座椅', 'https://images.unsplash.com/photo-1505843490538-5133c6c7d0e1?auto=format&fit=crop&w=400&q=70', 2600, 'A', 'discussing', 1, 1),
  ('bbbbbbbb-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'r56', '會議長桌 3.2m', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=400&q=70', 8900, 'A', 'confirmed', 1, 0),
  ('bbbbbbbb-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'r57', '會議椅（網布）', 'https://images.unsplash.com/photo-1580480055273-228ff5388ef8?auto=format&fit=crop&w=400&q=70', 980, 'A', 'pending', 10, 1),
  ('bbbbbbbb-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'r58', '開放式工作站', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=400&q=70', 3200, 'A', 'discussing', 12, 0),
  -- design basket (zone_id NULL = 尚未分配，作為設計籃)
  ('bbbbbbbb-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', NULL, 'r60', '矮櫃收納組', 'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?auto=format&fit=crop&w=400&q=70', 1500, 'A', 'pending', 1, 0),
  ('bbbbbbbb-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', NULL, 'r61', '休閒沙發（雙人）', 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?auto=format&fit=crop&w=400&q=70', 5400, 'A', 'pending', 1, 1),
  ('bbbbbbbb-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', NULL, 'r62', '茶几（實木）', 'https://images.unsplash.com/photo-1532372320572-cda25653a26d?auto=format&fit=crop&w=400&q=70', 1200, 'A', 'pending', 1, 2)
ON CONFLICT (id) DO NOTHING;

-- project_invitations
INSERT INTO project_invitations (id, project_id, channel, email, share_token, status, viewed_at, created_at) VALUES
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'link', NULL, 'tok_g7h8i9', 'viewed', '2026-06-01T16:30:00Z', '2026-05-31T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- client_companies (no contact_email — avoids seeding mock users into 用戶管理)
INSERT INTO client_companies (id, name, contact_person, contact_email, contact_phone, address, created_at, updated_at) VALUES
  ('dddddddd-0000-0000-0000-000000000001', '伊利沙伯中學舊生會中學', '黃智穎', NULL, NULL, '香港', '2026-01-10T09:00:00Z', '2026-07-21T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- product_discussions
INSERT INTO product_discussions (id, project_id, zone_product_id, author, author_role, body, mentions, created_at) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002', '黃智穎', 'client', '座椅顏色可否換成深啡色？ @設計師', ARRAY['設計師'], '2026-05-30T10:00:00Z'),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000002', 'Amy（設計師）', 'designer', '可以的，我們提供深啡色真皮選項，已加入方案 B 供比較。', ARRAY[]::TEXT[], '2026-05-30T10:30:00Z')
ON CONFLICT (id) DO NOTHING;
