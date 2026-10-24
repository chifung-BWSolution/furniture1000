-- FDS 2.1 PM報價（2026-10-24 PRD 釐清）
-- 快速報價：BWF PM 建報價單給 BWA PM，報價單可關聯 BWA 的 pitching 與項目。
-- 報價預算：BWA PM 選對應 pitching 下具體報價單裡的傢俬，即時試算預算。
-- 沿用現有 bwf_quote／bwf_quote_item／save_bwf_quote_items，只加 BWA 關聯欄，不改 PMS 契約。

ALTER TABLE public.bwf_quote
  ADD COLUMN IF NOT EXISTS bwa_pitching_id UUID,
  ADD COLUMN IF NOT EXISTS bwa_project_id UUID,
  ADD COLUMN IF NOT EXISTS bwa_project_ref TEXT,
  ADD COLUMN IF NOT EXISTS bwa_project_name TEXT;

COMMENT ON COLUMN public.bwf_quote.bwa_pitching_id IS
  'PMS BWA bwa_pitchings.id（跨庫 UUID，無本庫外鍵）。快速報價單關聯的 BWA 提案。';
COMMENT ON COLUMN public.bwf_quote.bwa_project_id IS
  'PMS BWA bwa_projects.id（跨庫 UUID，無本庫外鍵）。快速報價單關聯的 BWA 工程。';
COMMENT ON COLUMN public.bwf_quote.bwa_project_ref IS
  'BWA 工程編號（project_code／pitching_code 快照）。手填仍可用；手改編號會清掉關聯 id。';
COMMENT ON COLUMN public.bwf_quote.bwa_project_name IS
  'BWA 工程名稱快照。';

CREATE INDEX IF NOT EXISTS idx_bwf_quote_bwa_pitching
  ON public.bwf_quote (bwa_pitching_id)
  WHERE bwa_pitching_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bwf_quote_bwa_project
  ON public.bwf_quote (bwa_project_id)
  WHERE bwa_project_id IS NOT NULL;
