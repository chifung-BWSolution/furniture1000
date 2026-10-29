import type { SearchProduct } from '@/lib/productSearch';
import type { PresentationCompanyProfile } from '@/lib/presentationFiveSection';
import type { QuoteZoneRect } from '@/lib/quoteFloorPlan';

export interface PresentationZoneDraft {
  id: string;
  name: string;
  imageUrl?: string;
  rect?: QuoteZoneRect | null;
  /** All floor-plan areas belonging to this zone; rect remains the first area for compatibility. */
  rects?: QuoteZoneRect[];
  spaceType?: string;
  quantity?: number;
  /** Slide title shown for this room. Falls back to the zone name. */
  chapterTitle?: string;
  roomNote?: string;
}

export interface PresentationProductDraft {
  displayName: string;
  model: string;
  description: string;
  sellingPoints: string;
  marketPrice: string;
  projectPrice: string;
  imageUrl: string;
  /** User marked the catalog photo as a cutout, or detection said so. */
  noBackground: boolean;
  sampleImageUrl: string;
}

export interface PresentationCaseDraft {
  photos?: string[];
  id: string;
  title: string;
  body: string;
}

export interface PresentationOutlineInput {
  title: string;
  client: string;
  includeFloor: boolean;
  /** Original line-drawing floor plan. Only a layout reference when the AI render exists. */
  floorImageUrl?: string;
  /** AI top-down render. Replaces the line drawing as the floor-plan page hero image. */
  floorEffectImageUrl?: string;
  zones: PresentationZoneDraft[];
  products: SearchProduct[];
  productZone: Record<string, string>;
  drafts: Record<string, PresentationProductDraft>;
  company: PresentationCompanyProfile;
  companyIntro: string;
  qualifications: string;
  services: string;
  cases: PresentationCaseDraft[];
}

function line(label: string, value: string): string {
  const text = value.trim();
  return text ? `${label}：${text}` : '';
}

export function emptyProductDraft(product: SearchProduct): PresentationProductDraft {
  const images = (product.image_urls ?? []).filter((url) => url.startsWith('http'));
  const imageUrl = (product.image_url?.startsWith('http') ? product.image_url : '') || images[0] || '';
  return {
    displayName: product.title?.trim() || '',
    model: product.model?.trim() || product.sku?.trim() || '',
    description: '',
    sellingPoints: '',
    marketPrice: '',
    projectPrice: '',
    imageUrl,
    noBackground: false,
    sampleImageUrl: '',
  };
}

export function draftFor(product: SearchProduct, drafts: Record<string, PresentationProductDraft>): PresentationProductDraft {
  return drafts[product.id] ?? emptyProductDraft(product);
}

/** Facts already on the product. Does not invent comfort, silence, or certifications. */
export function draftFromProductFacts(product: SearchProduct): { description: string; sellingPoints: string } {
  const size = [product.dimension_l_mm, product.dimension_w_mm, product.dimension_h_mm]
    .filter((value) => value != null && value > 0)
    .join(' × ');
  const facts = [
    product.material?.trim() ? `材質：${product.material.trim()}` : '',
    product.color?.trim() ? `顏色：${product.color.trim()}` : '',
    size ? `尺寸：${size} mm` : '',
  ].filter(Boolean);
  return {
    description: facts.join('\n'),
    sellingPoints: '',
  };
}

export function presentationOutlineMarkdown(input: PresentationOutlineInput): string {
  const blocks: string[] = [];
  let index = 1;
  const heading = (title: string) => `${index++}. ${title}`;
  blocks.push([
    heading('封面'),
    ...[
      line('項目', input.title),
      line('客戶', input.client),
    ].filter(Boolean),
  ].join('\n'));

  if (input.includeFloor) {
    const names = input.zones.map((zone) => zone.name.trim()).filter(Boolean);
    blocks.push([
      heading('項目平面圖'),
      line('頁面主圖', input.floorEffectImageUrl?.trim() ? 'AI 俯視效果圖（取代原本平面圖）' : '整體平面圖'),
      line('分區', names.length ? names.join('、') : ''),
    ].filter(Boolean).join('\n'));
  }

  const unzoned = input.products.filter((product) => !input.zones.some((zone) => zone.id === input.productZone[product.id]));
  for (const zone of input.zones) {
    const name = zone.name.trim() || '未命名分區';
    const slideTitle = zone.chapterTitle?.trim() || name;
    blocks.push([
      heading(`分區封面｜${slideTitle}`),
      line('分區', name),
      zone.imageUrl?.trim() ? '頁面圖片：此分區的平面圖截圖' : '',
      line('房間描述', zone.roomNote ?? ''),
    ].filter(Boolean).join('\n'));
    for (const product of input.products) {
      if (input.productZone[product.id] !== zone.id) continue;
      const draft = draftFor(product, input.drafts);
      const image = draft.sampleImageUrl.trim() || draft.imageUrl.trim();
      const sample = draft.sampleImageUrl.trim();
      const body = [
        line('展示名稱', draft.displayName),
        line('型號', draft.model),
        image ? (sample ? '產品圖：使用此產品的 AI 生成示例圖（僅供參考，優先於原圖）' : '產品圖：使用此產品的原圖') : '',
        line('描述', draft.description),
        line('賣點', draft.sellingPoints),
        line('市場價', draft.marketPrice),
        line('項目優惠價', draft.projectPrice),
      ].filter(Boolean);
      blocks.push([heading(`產品頁｜${name}｜${draft.displayName.trim() || '未命名產品'}`), ...body].join('\n'));
    }
  }

  if (unzoned.length) {
    blocks.push([heading('未分區'), ...unzoned.map((product) => `- ${draftFor(product, input.drafts).displayName || product.title}`)].join('\n'));
  }

  for (const item of input.cases) {
    const title = item.title.trim();
    if (!title && !item.body.trim()) continue;
    blocks.push([heading(title || '參考案例'), item.body.trim(), ...(item.photos ?? []).map(url => `完工照片：${url}`)].filter(Boolean).join('\n'));
  }

  blocks.push([heading('服務承諾'), input.services.trim() || '內容待補充'].join('\n'));
  blocks.push([heading('資質'), input.qualifications.trim() || '內容待補充'].join('\n'));
  blocks.push([heading('公司介紹'), input.companyIntro.trim() || '內容待補充'].join('\n'));
  return blocks.join('\n\n');
}

export function presentationGenerateBlock(input: PresentationOutlineInput): string | null {
  if (!input.title.trim()) return '請填寫項目名稱。';
  if (!input.client.trim()) return '請填寫客戶名稱。';
  const sections = 1 + Number(input.includeFloor)
    + input.zones.length + input.products.length
    + input.cases.filter((item) => item.title.trim() || item.body.trim()).length
    + 3;
  if (sections > 100) return '大綱超過 Canva 的 100 頁上限，請減少分區、產品或案例。';
  if (input.zones.filter((zone) => zone.name.trim()).length === 0) return '請先建立至少一個分區。';
  for (const product of input.products) {
    const zoneId = input.productZone[product.id];
    if (!input.zones.some((zone) => zone.id === zoneId)) return '還有產品未分到分區。';
    const draft = draftFor(product, input.drafts);
    if (!draft.displayName.trim()) return '每件產品都要有展示名稱。';
    const image = draft.sampleImageUrl.trim() || draft.imageUrl.trim();
    if (!image) return '每件產品都要有一張圖片。';
    if (draft.noBackground && !draft.sampleImageUrl.trim()) return '沒有背景的產品圖要先生成示例圖。';
  }
  return null;
}

/** Cutout, transparent, or plain white studio shots count as having no scene. */
export async function imageLooksCutout(url: string): Promise<boolean> {
  const response = await fetch(url);
  if (!response.ok) return false;
  const bitmap = await createImageBitmap(await response.blob());
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(bitmap, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  bitmap.close();
  let transparent = 0;
  let whiteCorners = 0;
  const corners = [0, size - 1, (size - 1) * size, size * size - 1];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 200) transparent += 1;
  }
  for (const index of corners) {
    const offset = index * 4;
    const transparentCorner = data[offset + 3] < 200;
    const white = data[offset] > 245 && data[offset + 1] > 245 && data[offset + 2] > 245;
    if (transparentCorner || white) whiteCorners += 1;
  }
  return transparent / (size * size) > 0.08 || whiteCorners >= 3;
}
