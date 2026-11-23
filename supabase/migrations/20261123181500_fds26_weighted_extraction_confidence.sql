-- FDS-26：將提取項信心度改為按欄位缺漏比重累計扣分（取代原本一刀切 0.6 上限）。
-- 以 raw_json->>'confidence'（預設 0.85）為基準往下扣，保底 0.10：
--   缺成本價：圖冊 -0.25 / 報價單 -0.30
--   缺產品圖：-0.25
--   缺型號：  -0.25
--   尺寸缺失：缺 1 維 -0.10 / 缺 2 維 -0.15 / 全缺 -0.20
--   尺寸可疑（<50 或 >6000mm）：-0.10
--   價格不在原文：-0.35；圖片價格：-0.10；AI 不確定：-0.05；顏色未對上：-0.05

with scored as (
  select
    e.id,
    e.flags,
    (
      case when nullif(btrim(coalesce(e.corrected_json ->> 'model', e.raw_json ->> 'model', '')), '') is null then 0.25 else 0 end
      + case when e.main_image_id is null then 0.25 else 0 end
      + case
          when coalesce(public.fds_try_numeric(coalesce(e.corrected_json ->> 'price', e.raw_json ->> 'price')), 0) <= 0 then
            case when 'catalog_no_price' = any(coalesce(e.flags, '{}'::text[])) then 0.25 else 0.30 end
          else 0
        end
      + case (
          case when public.fds_try_numeric(coalesce(e.corrected_json ->> 'width_mm', e.raw_json ->> 'width_mm')) is null then 1 else 0 end
          + case when public.fds_try_numeric(coalesce(e.corrected_json ->> 'depth_mm', e.raw_json ->> 'depth_mm')) is null then 1 else 0 end
          + case when public.fds_try_numeric(coalesce(e.corrected_json ->> 'height_mm', e.raw_json ->> 'height_mm')) is null then 1 else 0 end
        )
          when 1 then 0.10
          when 2 then 0.15
          when 3 then 0.20
          else 0
        end
      + case when 'dimension_suspicious' = any(coalesce(e.flags, '{}'::text[])) then 0.10 else 0 end
      + case when 'price_not_in_source' = any(coalesce(e.flags, '{}'::text[])) then 0.35 else 0 end
      + case when 'price_from_image' = any(coalesce(e.flags, '{}'::text[])) then 0.10 else 0 end
      + case when 'ai_uncertain' = any(coalesce(e.flags, '{}'::text[])) then 0.05 else 0 end
      + case when 'color_unmapped' = any(coalesce(e.flags, '{}'::text[])) then 0.05 else 0 end
    ) as penalty,
    least(1.0, greatest(0.1, coalesce(public.fds_try_numeric(e.raw_json ->> 'confidence'), 0.85))) as base_conf
  from public.extraction_items e
),
computed as (
  select
    s.id,
    round(greatest(0.10, s.base_conf - s.penalty)::numeric, 3) as new_conf
  from scored s
)
update public.extraction_items e
set confidence = c.new_conf,
    flags = case
      when c.new_conf < 0.7 and not ('low_confidence' = any(coalesce(e.flags, '{}'::text[])))
        then array_append(coalesce(e.flags, '{}'::text[]), 'low_confidence')
      when c.new_conf >= 0.7 and ('low_confidence' = any(coalesce(e.flags, '{}'::text[])))
        then array_remove(coalesce(e.flags, '{}'::text[]), 'low_confidence')
      else e.flags
    end,
    updated_at = now()
from computed c
where e.id = c.id;

notify pgrst, 'reload schema';
