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
    inputText: [String(brief.title ?? ''), outline, ...images].join('\n\n'),
    textMode: 'preserve',
    format: 'presentation',
    numCards: Math.min(100, Math.max(1, Number(brief.pageCount) || 12)),
    exportAs: 'pptx',
    imageOptions: { source: 'noImages' },
    additionalInstructions: `使用繁體中文。${String(brief.style ?? '專業、簡潔')}。依大綱安排圖片，保留產品外觀、尺寸與價格，不捏造資料；平面圖完整顯示。`,
  };
}

export async function gammaRequest(path: string, body?: unknown): Promise<GammaGeneration> {
  const key = Deno.env.get('GAMMA_API_KEY');
  if (!key) throw new Error('尚未設定 GAMMA_API_KEY。');
  if (!/^\/generations(?:\/[A-Za-z0-9_-]+)?$/.test(path)) throw new Error('invalid_gamma_path');
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
