-- Align 方案列表 demo seed with 報價一覽 / PMS pitching customers (real data).
-- Safe to re-run: fixed UUIDs only.

UPDATE design_projects SET
  name = '伊利沙伯中學舊生會中學 課室及辦公傢俬',
  client_company = '伊利沙伯中學舊生會中學',
  client_name = '黃智穎',
  meta = jsonb_build_object(
    'projectType', 'school',
    'pitchingCode', 'BWF-SH26-060',
    'quoteId', 'BWF-SH26-060'
  ),
  updated_at = '2026-07-21T09:00:00Z'
WHERE id = '11111111-1111-1111-1111-111111111111';

UPDATE design_projects SET
  name = 'HK PolyU Charlene Zhou 傢俬方案',
  client_company = 'HK PolyU Charlene Zhou',
  client_name = 'Charlene Zhou',
  meta = jsonb_build_object(
    'projectType', 'school',
    'pitchingCode', 'BWF-SH26-061',
    'quoteId', 'BWF-SH26-061'
  ),
  updated_at = '2026-07-21T09:00:00Z'
WHERE id = '22222222-2222-2222-2222-222222222222';

UPDATE design_projects SET
  name = '仁濟醫院 診所傢俬配置',
  client_company = '仁濟醫院',
  client_name = 'Yan Chai Hospital',
  meta = jsonb_build_object(
    'projectType', 'clinic',
    'pitchingCode', 'BWF-SH26-058'
  ),
  updated_at = '2026-07-21T09:00:00Z'
WHERE id = '33333333-3333-3333-3333-333333333333';

UPDATE project_zones SET name = '校長室' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE project_zones SET name = '課室' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
UPDATE project_zones SET name = '教員室' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';

UPDATE client_companies SET
  name = '伊利沙伯中學舊生會中學',
  contact_person = '黃智穎',
  address = '香港',
  updated_at = '2026-07-21T09:00:00Z'
WHERE id = 'dddddddd-0000-0000-0000-000000000001';

UPDATE product_discussions SET author = '黃智穎'
WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';
