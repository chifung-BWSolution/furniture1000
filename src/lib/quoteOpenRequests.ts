/**
 * 由其他頁面要求「打開某張報價單」的請求。
 *
 * 交給 AppShell 用 openQuoteForEdit 處理，才會一併校正 uuid／版本並清走舊草稿標記；
 * 單純 navigate('/quote/:id') 會沿用上一次的 editingQuoteUuid，可能載入錯版本。
 * 目前用於右上角「查看並匯入」toast：生成完成時用戶可能已離開報價單頁。
 */
type QuoteOpenRequest = { quoteId: string };

let request: QuoteOpenRequest | null = null;
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function requestQuoteOpen(quoteId: string) {
  const id = quoteId.trim();
  if (!id) return;
  request = { quoteId: id };
  emit();
}

export function takeQuoteOpenRequest(): QuoteOpenRequest | null {
  const current = request;
  if (!current) return null;
  request = null;
  emit();
  return current;
}

export function subscribeQuoteOpenRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function quoteOpenRequestVersion() {
  return version;
}
