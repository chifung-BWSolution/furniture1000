// ============================================================================
// FDS 2.1 Day 9 — 簡報資料模型（T-901～T-903，F-AI-009）
// 決議 C-07：「結構化產品資料＋固定模板」——Canva PPT 與未來的專業說明 PDF
// 共用同一份 PresentationDoc、版面常數與文字整理規則，只換渲染器
// （PPT：presentationPptx.ts＋pptxgenjs；PDF：日後 @react-pdf/renderer）。
// 產品資料一律經 fds_search_products FRONTEND 搜尋層取得：成本角色遮蔽
// （decision C-04）在此沿用，不重新查 supplier_prices。
// ============================================================================

import { sizeLabel, moneyLabel, type SearchProduct } from '@/lib/productSearch';

/** Shared brand/template elements (C-07) — PPT and future pro-PDF use these. */
export const PRESENTATION_THEME = {
  /** 16:9 slide, inches (PowerPoint default widescreen). */
  width: 13.333,
  height: 7.5,
  font: 'Microsoft JhengHei',
  primary: '0F172A', // slate-900 — headings
  accent: '2563EB', // blue-600 — brand strip / highlights
  muted: '64748B', // slate-500 — secondary text
  panel: 'F1F5F9', // slate-100 — info panel background
  line: 'E2E8F0', // slate-200 — hairlines
  white: 'FFFFFF',
} as const;

export interface PresentationMeta {
  /** 簡報標題（封面）。 */
  title: string;
  /** 副標題：公司／專案名。 */
  subtitle: string;
  /** 日期標籤（自動生成，可改）。 */
  dateLabel: string;
  /** 是否顯示價錢（未授權／不想報價時可關）。 */
  showPrices: boolean;
}

export interface PresentationItem {
  productId: string;
  title: string;
  model?: string;
  /** First HTTP gallery URL for rendering（無 base64）。 */
  image_url?: string;
  size?: string;
  material?: string;
  color?: string;
  factory_name?: string;
  category?: string;
  in_stock?: boolean;
  /** 折扣價（售價×0.8）。 */
  discountLabel?: string;
  originalLabel?: string;
}

export interface PresentationDoc {
  meta: PresentationMeta;
  items: PresentationItem[];
}

function firstHttpImage(p: SearchProduct): string | undefined {
  const listed = (p.image_urls ?? []).filter((url) => /^https?:\/\//i.test(url));
  if (listed.length > 0) return listed[0];
  return p.image_url && /^https?:\/\//i.test(p.image_url) ? p.image_url : undefined;
}

/**
 * 整理內容（T-901）。決議 C-07 走「固定模板」路線：規則化整理，不用 LLM 隨機發揮。
 * 型號獨立抽出、尺寸用搜索層 sizeLabel、價錢用折扣價＋原價（遮蔽已由 RPC 保證）。
 */
export function buildPresentationDoc(
  meta: PresentationMeta,
  products: SearchProduct[],
): PresentationDoc {
  const items: PresentationItem[] = products.map((p) => {
    const model = (p.model ?? '').trim() || (p.sku ?? '').trim() || undefined;
    return {
      productId: p.id,
      title: p.title?.trim() || model || '未命名產品',
      model,
      image_url: firstHttpImage(p),
      size: sizeLabel(p) ?? undefined,
      material: p.material?.trim() || undefined,
      color: p.color?.trim() || undefined,
      factory_name: p.factory_name?.trim() || undefined,
      category: p.level2_category?.trim() || p.level1_category?.trim() || undefined,
      in_stock: p.in_stock ?? undefined,
      discountLabel: meta.showPrices ? (moneyLabel(p.middle_price, 'HK$') ?? undefined) : undefined,
      originalLabel: meta.showPrices && p.middle_price ? (moneyLabel(p.sale_price, 'HK$') ?? undefined) : undefined,
    };
  });
  return {
    meta: {
      ...meta,
      title: meta.title.trim() || '傢俬簡報',
      subtitle: meta.subtitle.trim(),
    },
    items,
  };
}

export function defaultMetaFromProducts(products: SearchProduct[], showPrices: boolean): PresentationMeta {
  const now = new Date();
  const dateLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
  const factory = [...new Set(products.map((p) => p.factory_name?.trim()).filter(Boolean))];
  if (factory.length === 1) {
    return { title: `${factory[0]} 產品簡報`, subtitle: '', dateLabel, showPrices };
  }
  return { title: '傢俬選品簡報', subtitle: '', dateLabel, showPrices };
}
