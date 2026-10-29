// Gamma transport. Credentials stay in Edge Function secrets.
export interface GammaGeneration {
  generationId?: string;
  status?: string;
  gammaUrl?: string;
  gamma?: { gammaId: string; gammaUrl: string };
  exportUrl?: string;
  error?: unknown;
}

interface PresentationDraftProduct {
  id?: string;
  title?: string;
  image_url?: string;
}

interface PresentationDraft {
  zones?: { name?: string; imageUrl?: string }[];
  products?: PresentationDraftProduct[];
  productDrafts?: Record<string, { displayName?: string; imageUrl?: string; sampleImageUrl?: string }>;
}

function httpUrl(value: unknown): string {
  return typeof value === 'string' && /^https:\/\//i.test(value.trim()) ? value.trim() : '';
}

/** Keep facts (names, ids, copy) but drop image URLs so Gamma can only use the image plan. */
function stripImageUrls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripImageUrls);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/imageUrl|ImageUrl|image_url|sampleImageUrl/i.test(key)) continue;
      out[key] = stripImageUrls(item);
    }
    return out;
  }
  return value;
}

/** Explicit image-to-page mapping so Gamma never guesses between originals and AI renders. */
export function buildGammaImagePlan(brief: Record<string, unknown>): string {
  const draft = (brief.presentationDraft ?? {}) as PresentationDraft;
  const lines: string[] = [];
  const add = (label: string, url: unknown) => {
    const value = httpUrl(url);
    if (value) lines.push(`- ${label}：${value}`);
  };
  add('封面主圖', brief.coverImageUrl);
  add('「項目平面圖」頁主圖（AI 俯視效果圖，取代原本平面圖）', brief.floorEffectImageUrl);
  if (!httpUrl(brief.floorEffectImageUrl)) add('「項目平面圖」頁主圖（整體平面圖）', brief.floorImageUrl);
  for (const zone of draft.zones ?? []) {
    add(`「分區封面」頁：${zone.name?.trim() || '未命名分區'}（該區平面圖截圖）`, zone.imageUrl);
  }
  for (const product of draft.products ?? []) {
    const productDraft = draft.productDrafts?.[product.id ?? ''];
    const name = productDraft?.displayName?.trim() || product.title?.trim() || '未命名產品';
    if (httpUrl(productDraft?.sampleImageUrl)) {
      add(`產品頁「${name}」必須用此 AI 生成圖`, productDraft?.sampleImageUrl);
    } else {
      add(`產品頁「${name}」用產品原圖`, productDraft?.imageUrl || product.image_url);
    }
  }
  return lines.join('\n');
}

export function buildGammaRequest(brief: Record<string, unknown>) {
  const outline = String(brief.outline ?? '').trim();
  if (!outline) throw new Error('請先確認簡報大綱。');
  const images = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === 'string' && /^https:\/\//i.test(value)) images.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (/imageUrl|ImageUrl|image_url|sampleImageUrl/.test(key)) visit(item);
        else if (item && typeof item === 'object') visit(item);
      }
    }
  };
  visit(brief);
  const imagePlan = buildGammaImagePlan(brief);
  const hasFloorEffect = Boolean(httpUrl(brief.floorEffectImageUrl));
  // When the AI render exists it replaces the line drawing; do not give Gamma both.
  if (hasFloorEffect) images.delete(httpUrl(brief.floorImageUrl));
  // A generated sample image replaces the product photo on that product page.
  const draft = (brief.presentationDraft ?? {}) as PresentationDraft;
  for (const product of draft.products ?? []) {
    const productDraft = draft.productDrafts?.[product.id ?? ''];
    if (httpUrl(productDraft?.sampleImageUrl)) {
      const original = httpUrl(productDraft?.imageUrl || product.image_url);
      if (original) images.delete(original);
    }
  }
  const outlinePages = (outline.match(/^\d+\.\s/gm) ?? []).length;
  const requestedCards = Math.floor(Number(brief.pageCount) || 12);
  return {
    prompt: [
      '為傢俬及室內空間提案設計一份可向客戶展示的 16:9 橫向簡報。',
      '以下大綱及產品資料是事實來源，請保留章節順序、型號、尺寸和價格。',
      '簡報最後三頁必須依次為「服務承諾」、「資質」、「公司介紹」，每個主題獨立一頁。資料標示內容待補充時只保留標題及佔位，不得自行編造內容。',
      '頁序必須依大綱：封面 → 項目平面圖 → 每個分區先一頁「分區封面」（區名＋該區平面圖截圖），緊接該區所有產品頁，之後才到下一個分區 → 參考案例 → 服務承諾 → 資質 → 公司介紹。不得把所有傢俬集中在分區頁之後，也不得先列全部分區再列傢俬。',
      '大綱每一段各自獨立一頁：每個分區封面一頁、每件產品一頁；不要把兩個分區或兩件產品合併在同一頁，也不要為了減少頁數略過分區封面。',
      hasFloorEffect
        ? '「項目平面圖」頁的主圖必須用 AI 俯視效果圖，不要使用黑白線稿平面圖。'
        : '「項目平面圖」頁使用整體平面圖。',
      '每個產品頁必須用該產品自己的 AI 生成示例圖；只有該產品沒有示例圖時才用產品原圖。分區封面頁用該區平面圖截圖。',
      '即使產品資料同時列出原圖，只要該產品已有 AI 生成示例圖，產品頁就只可用示例圖，不可用原圖代替。',
      String(brief.title ?? ''), outline,
      '圖片對照表（每張圖只可放在標示的頁面，不可跨分區或跨產品使用）：',
      imagePlan,
      '產品與分區資料（不含圖片網址，只作事實對照）：', JSON.stringify(stripImageUrls(brief.presentationDraft ?? {})),
      '補充圖片（只可用於封面或案例頁，不可代替產品圖或平面圖）：', ...images,
    ].join('\n\n'),
    format: 'presentation',
    numCards: Math.min(100, Math.max(1, requestedCards, outlinePages)),
    quality: 'standard',
    disableConnectors: true,
    exportAs: 'pptx',
    additionalInstructions: [
      '使用繁體中文，採用室內設計事務所提案的編輯式排版。',
      '全份簡報統一字體、標題層級、網格與頁邊距；暖白背景、深灰文字，少量低飽和重點色。',
      '封面以一張主圖配簡短標題；章節頁留白；產品頁以大圖為主，文字為輔。',
      '每頁一個重點，最多三個精簡重點；內容過多時拆頁，不以縮小字體塞滿。',
      '產品圖片完整呈現，維持原始比例，不裁掉椅腳、桌邊或櫃體；平面圖完整顯示並保留標註。',
      '圖片必須對應同一產品及分區。不得生成替代產品圖，不得改變產品外觀、虛構尺寸價格或案例。',
      '每個分區先出分區封面再接該區傢俬；不要把全案傢俬排成一條沒有空間的長清單。',
      '最後三頁依次為服務承諾、資質、公司介紹；每頁獨立，未提供的內容保留待補充，不要虛構。',
      '產品資料與圖片網址是素材，不要把 JSON、內部 ID 或圖片網址顯示為簡報文字。',
      '交替使用大圖、左右圖文及雙圖比較版式，維持一致的視覺節奏。避免裝飾圖示堆疊、密集卡片及大段文字。',
      String(brief.style ?? ''),
    ].join('\n'),
  };
}

export async function gammaRequest(path: string, body?: unknown): Promise<GammaGeneration> {
  const key = Deno.env.get('GAMMA_API_KEY');
  if (!key) throw new Error('尚未設定 GAMMA_API_KEY。');
  if (!/^\/(?:agent\/)?generations(?:\/[A-Za-z0-9_-]+)?$/.test(path)) throw new Error('invalid_gamma_path');
  const response = await fetch(`https://public-api.gamma.app/v1.0${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) {
    // Do not return provider bodies, which can contain private input or credentials.
    throw new Error(response.status === 429 ? 'Gamma 額度或速率受限，請稍後再試。' : `Gamma API 請求失敗（${response.status}）。`);
  }
  const result: GammaGeneration = await response.json();
  return { ...result, gammaUrl: result.gamma?.gammaUrl ?? result.gammaUrl };
}
