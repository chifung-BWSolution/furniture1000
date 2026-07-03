/** Per-user sessionStorage keys for the quick-quote wizard (steps 1–3). */

function normalizeEmail(email: string | null | undefined): string {
  return (email?.trim().toLowerCase() || 'anonymous');
}

export function quickQuoteStepKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:currentStep`;
}

export function quickQuoteFormKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:formData`;
}

export function resetQuickQuoteSessionStorage(email: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(quickQuoteStepKey(email));
  sessionStorage.removeItem(quickQuoteFormKey(email));
}

export function readQuickQuoteStep(email: string | null | undefined): number {
  if (typeof window === 'undefined') return 1;
  const saved = sessionStorage.getItem(quickQuoteStepKey(email));
  const n = saved ? parseInt(saved, 10) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : 1;
}

export const QUOTE_UNSAVED_LEAVE_MESSAGE =
  '報價內容尚未儲存。離開前請先按「取消」再按「版本審核」，否則內容將會遺失。';
