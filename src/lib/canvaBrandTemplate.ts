/** FDS 品牌模板 Autofill 欄位名（須與 Canva Bulk Create 資料欄一致）。 */
export const FDS_CANVA_BRAND_FIELDS = [
  'FDS_COVER_TITLE',
  'FDS_COVER_SUBTITLE',
  'FDS_COVER_CLIENT',
  'FDS_COVER_PURPOSE',
  'FDS_COVER_DATE',
  'FDS_OUTLINE',
  'FDS_OUTLINE_1',
  'FDS_OUTLINE_2',
  'FDS_OUTLINE_3',
  'FDS_OUTLINE_4',
  'FDS_OUTLINE_5',
  ...Array.from({ length: 12 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return [`FDS_PROD_${n}_TITLE`, `FDS_PROD_${n}_DETAILS`, `FDS_PROD_${n}_IMAGE`];
  }).flat(),
] as const;

export const CANVA_AUTOFILL_DOC_PATH = 'docs/prd/FDS-2.1-Canva品牌模板Autofill.md';
