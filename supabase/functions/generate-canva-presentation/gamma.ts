// Gamma transport. Credentials stay in Edge Function secrets.
export interface GammaGeneration {
  generationId?: string;
  status?: string;
  gammaUrl?: string;
  exportUrl?: string;
  error?: unknown;
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
  return {
    prompt: [
      '為傢俬及室內空間提案設計一份可向客戶展示的 16:9 橫向簡報。',
      '以下大綱及產品資料是事實來源，請保留章節順序、型號、尺寸和價格。',
      String(brief.title ?? ''), outline,
      '圖片素材及其資料關聯：', JSON.stringify(brief.presentationDraft ?? {}),
      '補充圖片（僅使用與該頁主題對應的圖片）：', ...images,
    ].join('\n\n'),
    format: 'presentation',
    numCards: Math.min(100, Math.max(1, Math.floor(Number(brief.pageCount) || 12))),
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
  return await response.json();
}
