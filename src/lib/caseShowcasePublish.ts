/**
 * 成功案例 › 導出／發布共用核心（輕量，不含 xlsx／PDF 依賴）。
 *
 * PRD：docs/prd/成功案例-PRD.md F-CASE-004／F-CASE-005。
 *
 * 原則：
 * 1. 脫敏在資料結構層強制——導出／發布的型別只含對外欄位，
 *    工廠、安裝團隊、內部備註、成本在結構上進不來（BR-CASE-02）。
 * 2. 發布只存「精選並修改後」的對外內容，不複製 PMS 原始訂單／客戶資料（BR-CASE-04）。
 * 3. 發布走 FDS 表 case_showcase_publishes + RLS，不新增 edge function。
 *    此模組被客戶專區（輕量 chunk）引用，禁止引入重量級依賴。
 */

import { supabase } from '@/lib/supabase';
import { imageUrl, photoUrls } from '@/lib/caseShowcase';
import type { CaseBrand, CaseOrder, CasePhotoProject } from '@/lib/caseShowcase';

export const CASE_PUBLISH_ROW_ID = '00000000-0000-0000-0000-000000000001';

// ─── 導出項目（導出預覽可編輯） ─────────────────────────────────────────────

export type CaseExportKind = 'order' | 'photo' | 'brand';

export interface CaseExportItem {
  key: string;
  kind: CaseExportKind;
  /** 對外顯示名稱（可編輯，預設取項目編號／品牌名）。 */
  title: string;
  /** 對外說明（可編輯，預設空）。 */
  note: string;
  /** PM 名稱是否顯示（BR-CASE-07：預設隱藏）。 */
  showPm: boolean;
  /** 訂單數據項目：同組訂單列（已脫敏，僅對外欄位進入導出）。 */
  orders?: CaseOrder[];
  /** 完工相片項目。 */
  photoProject?: CasePhotoProject;
  /** 相片取捨（photo 項目用）。 */
  photos?: { url: string; include: boolean }[];
  /** 知名客戶項目。 */
  brand?: CaseBrand;
}

export function buildExportItem(
  kind: 'order',
  key: string,
  orders: CaseOrder[],
): CaseExportItem;
export function buildExportItem(
  kind: 'photo',
  key: string,
  project: CasePhotoProject,
): CaseExportItem;
export function buildExportItem(
  kind: 'brand',
  key: string,
  brand: CaseBrand,
): CaseExportItem;
export function buildExportItem(
  kind: CaseExportKind,
  key: string,
  data: CaseOrder[] | CasePhotoProject | CaseBrand,
): CaseExportItem {
  if (kind === 'order') {
    const orders = data as CaseOrder[];
    return {
      key,
      kind,
      title: orders[0]?.project_name || orders[0]?.project_code || '未命名項目',
      note: '',
      showPm: false,
      orders,
      photos: photoUrls(orders[0]?.completion_photos).map((url) => ({
        url,
        include: true,
      })),
    };
  }
  if (kind === 'photo') {
    const project = data as CasePhotoProject;
    return {
      key,
      kind,
      title: project.project_name || project.project_code || '未命名項目',
      note: '',
      showPm: false,
      photoProject: project,
      photos: photoUrls(project.completion_photos).map((url) => ({
        url,
        include: true,
      })),
    };
  }
  const brand = data as CaseBrand;
  return {
    key,
    kind,
    title: brand.brand_name_cn || brand.brand_name_en || brand.company_name || brand.display_name || '未命名品牌',
    note: '',
    showPm: false,
    brand,
  };
}

export function safeCaseDate(raw: string | null | undefined): string {
  if (!raw || Number.isNaN(Date.parse(raw))) return '';
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(raw));
}

export function exportItemPmName(item: CaseExportItem): string {
  if (!item.showPm) return '';
  if (item.kind === 'order') return item.orders?.[0]?.pm_name || '';
  if (item.kind === 'photo') return item.photoProject?.pm_name || '';
  return '';
}

// ─── 發布 payload（結構上只含對外內容） ─────────────────────────────────────

export interface CasePublishCase {
  kind: 'photo' | 'order';
  title: string;
  note: string;
  /** 完工相片項目：封面＋相簿（只存 URL）。 */
  cover: string | null;
  photos: string[];
  pmName: string | null;
  /** 訂單數據項目：對外統計（產品數、總數量）。 */
  productCount: number | null;
  totalQuantity: number | null;
}

export interface CasePublishBrand {
  name: string;
  logoUrl: string | null;
}

export interface CasePublishPayload {
  publishedAt: string;
  cases: CasePublishCase[];
  brands: CasePublishBrand[];
}

/** 由導出項目建立發布 payload；只取對外欄位，脫敏欄位無法進入。 */
export function buildPublishPayload(items: CaseExportItem[]): CasePublishPayload {
  const cases: CasePublishCase[] = [];
  const brands: CasePublishBrand[] = [];
  for (const item of items) {
    if (item.kind === 'photo' && item.photoProject) {
      const photos = (item.photos || [])
        .filter((p) => p.include)
        .map((p) => p.url);
      cases.push({
        kind: 'photo',
        title: item.title,
        note: item.note,
        cover: photos[0] || null,
        photos,
        pmName: item.showPm ? item.photoProject.pm_name || null : null,
        productCount: null,
        totalQuantity: null,
      });
    } else if (item.kind === 'order' && item.orders?.length) {
      const quantities = item.orders
        .map((o) => o.quantity)
        .filter((q): q is number => q !== null);
      const photos = (item.photos || [])
        .filter((p) => p.include)
        .map((p) => p.url);
      cases.push({
        kind: 'order',
        title: item.title,
        note: item.note,
        cover: photos[0] || null,
        photos,
        pmName: item.showPm ? item.orders[0]?.pm_name || null : null,
        productCount: item.orders.length,
        totalQuantity: quantities.length
          ? quantities.reduce((sum, n) => sum + n, 0)
          : null,
      });
    } else if (item.kind === 'brand' && item.brand) {
      brands.push({
        name: item.title,
        logoUrl: imageUrl(item.brand.branding_icon),
      });
    }
  }
  return { publishedAt: new Date().toISOString(), cases, brands };
}

/** 讀取最新發布（客戶專區用；無發布回 null，頁面回退靜態內容）。 */
export async function fetchPublishedCaseShowcase(): Promise<CasePublishPayload | null> {
  const { data, error } = await supabase
    .from('case_showcase_publishes')
    .select('payload')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return null;
  const payload = data?.[0]?.payload as CasePublishPayload | undefined;
  return payload && Array.isArray(payload.cases) ? payload : null;
}

/** 發布到客戶專區：固定單列 upsert，客戶專區永遠顯示最新一次發布。 */
export async function publishCaseShowcase(
  payload: CasePublishPayload,
): Promise<void> {
  const { error } = await supabase.from('case_showcase_publishes').upsert(
    {
      id: CASE_PUBLISH_ROW_ID,
      payload,
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(error.message);
}
