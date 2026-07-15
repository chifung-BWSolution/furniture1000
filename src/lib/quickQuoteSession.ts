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
  sessionStorage.removeItem(quickQuoteEditingIdKey(email));
}

export function quickQuoteEditingIdKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:editingQuoteId`;
}

export function readQuickQuoteEditingId(email: string | null | undefined): string | null {
  if (typeof window === 'undefined') return null;
  const v = sessionStorage.getItem(quickQuoteEditingIdKey(email));
  return v && v.trim() ? v : null;
}

export function writeQuickQuoteEditingId(
  email: string | null | undefined,
  quoteId: string | null,
): void {
  if (typeof window === 'undefined') return;
  const key = quickQuoteEditingIdKey(email);
  if (quoteId) sessionStorage.setItem(key, quoteId);
  else sessionStorage.removeItem(key);
}

function draftRestoreNoticeKey(email: string | null | undefined, quoteId: string): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:draftNotice:${quoteId}`;
}

/** Show draft-restore toast at most once per browser tab session per quote. */
export function shouldShowDraftRestoreNotice(
  email: string | null | undefined,
  quoteId: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const key = draftRestoreNoticeKey(email, quoteId);
  if (sessionStorage.getItem(key)) return false;
  sessionStorage.setItem(key, '1');
  return true;
}

export function readQuickQuoteStep(email: string | null | undefined): number {
  if (typeof window === 'undefined') return 1;
  const saved = sessionStorage.getItem(quickQuoteStepKey(email));
  const n = saved ? parseInt(saved, 10) : 1;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : 1;
}

export const QUOTE_UNSAVED_LEAVE_MESSAGE =
  '您有未儲存的報價修改。離開前請先按「版本審核」提交，否則內容將會遺失。';
