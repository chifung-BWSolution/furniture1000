/**
 * 「查看並匯入」toast 的跨頁交接。
 *
 * 生圖可能要幾分鐘，用戶往往已切去其他頁面；報價單編輯器一旦卸載，
 * toast 內 action 的 setState 就不會生效，點了等於沒反應。
 * 這裡把完成的生成圖暫存起來，點擊 toast 時先跳回對應報價單，
 * 編輯器重新載入後再取出這張圖開預覽，行為與留在報價單頁時一致。
 */
import type { LayoutReview } from './quoteLayoutRender';
import type { QuotePhotoAsset } from './quotePhotoLibrary';

/** 分區渲染圖預覽的內容：與編輯器內的 zoneRenderPreview state 同一個形狀。 */
export type ZoneRenderPreviewPayload = {
  zoneId: string;
  zoneName: string;
  snapshot: string;
  asset?: QuotePhotoAsset;
  zoneImage?: string;
  review?: LayoutReview | null;
  error?: string;
  /** 分區有多個互不相連的區域時，這次隨機選了哪一處。 */
  area?: { index: number; total: number };
  /** 重新生成前的那一張，放在預覽內對比。 */
  previous?: { url: string; feedback?: string };
  /** 已按對照結果自動修正的次數。 */
  autoFixes?: number;
};

const pending = new Map<string, ZoneRenderPreviewPayload>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

/** 記住某張報價單等待開啟的生成圖（同一張單只保留最新一張）。 */
export function rememberZoneRenderPreview(quoteKey: string, payload: ZoneRenderPreviewPayload) {
  const key = quoteKey.trim();
  if (!key) return;
  pending.set(key, payload);
  emit();
}

/** 取出並清除，避免之後每次重掛都再彈一次。 */
export function takeZoneRenderPreview(quoteKey: string): ZoneRenderPreviewPayload | null {
  const key = quoteKey.trim();
  const payload = pending.get(key);
  if (!payload) return null;
  pending.delete(key);
  emit();
  return payload;
}

export function subscribeZoneRenderPreviews(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function zoneRenderPreviewVersion() {
  return version;
}
