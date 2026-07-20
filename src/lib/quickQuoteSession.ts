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

/** Source bwf_quote.id (UUID) when duplicating via 複製報價單. */
export function quickQuoteCopyFromKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:copyFromUuid`;
}

export function readQuickQuoteCopyFrom(
  email: string | null | undefined,
): string | null {
  if (typeof window === 'undefined') return null;
  const v = sessionStorage.getItem(quickQuoteCopyFromKey(email));
  return v && v.trim() ? v : null;
}

export function writeQuickQuoteCopyFrom(
  email: string | null | undefined,
  quoteUuid: string | null,
): void {
  if (typeof window === 'undefined') return;
  const key = quickQuoteCopyFromKey(email);
  if (quoteUuid?.trim()) sessionStorage.setItem(key, quoteUuid.trim());
  else sessionStorage.removeItem(key);
}

function resumeQuoteKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:resume`;
}

function useLocalDraftKey(email: string | null | undefined): string {
  return `bwf:quickQuote:${normalizeEmail(email)}:useLocalDraft`;
}

export function resetQuickQuoteSessionStorage(
  email: string | null | undefined,
  opts?: { keepCopyFrom?: boolean },
): void {
  if (typeof window === 'undefined') return;
  const copyFrom = opts?.keepCopyFrom ? readQuickQuoteCopyFrom(email) : null;
  sessionStorage.removeItem(quickQuoteStepKey(email));
  sessionStorage.removeItem(quickQuoteFormKey(email));
  sessionStorage.removeItem(quickQuoteEditingIdKey(email));
  sessionStorage.removeItem(quickQuoteCopyFromKey(email));
  sessionStorage.removeItem(resumeQuoteKey(email));
  sessionStorage.removeItem(useLocalDraftKey(email));
  if (copyFrom) writeQuickQuoteCopyFrom(email, copyFrom);
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
  '您有未提交審核的報價修改（本機可能已自動暫存）。離開前如需正式存檔請按「版本審核」，否則伺服器上仍是舊版本。';

/** Resume markers so a post-deploy reload reopens the same quote. */
export type ResumeQuoteMarker = {
  quoteId: string;
  quoteUuid?: string | null;
  savedAt: number;
};

export function writeResumeQuote(
  email: string | null | undefined,
  marker: { quoteId: string; quoteUuid?: string | null },
): void {
  if (typeof window === 'undefined') return;
  const quoteId = marker.quoteId?.trim();
  if (!quoteId) return;
  const payload: ResumeQuoteMarker = {
    quoteId,
    quoteUuid: marker.quoteUuid ?? null,
    savedAt: Date.now(),
  };
  sessionStorage.setItem(resumeQuoteKey(email), JSON.stringify(payload));
  // Keep editing id in sync so AppShell can reopen after reload.
  if (quoteId !== 'NEW') {
    writeQuickQuoteEditingId(email, quoteId);
  }
}

export function readResumeQuote(
  email: string | null | undefined,
): ResumeQuoteMarker | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(resumeQuoteKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeQuoteMarker;
    if (!parsed?.quoteId?.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear resume marker without reading. */
export function clearResumeQuote(email: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(resumeQuoteKey(email));
}

/** Read and clear resume marker (call once on app shell mount). */
export function consumeResumeQuote(
  email: string | null | undefined,
): ResumeQuoteMarker | null {
  const marker = readResumeQuote(email);
  clearResumeQuote(email);
  return marker;
}

/**
 * Prefer IndexedDB draft over Supabase only after in-tab editing (autosave / F5).
 * Opening a quote from 報價一覽 must clear this so server (版本審核) data wins.
 */
export function markUseLocalQuoteDraft(
  email: string | null | undefined,
  quoteId: string,
): void {
  if (typeof window === 'undefined') return;
  const id = quoteId?.trim();
  if (!id) return;
  sessionStorage.setItem(useLocalDraftKey(email), id);
}

export function clearUseLocalQuoteDraft(
  email: string | null | undefined,
): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(useLocalDraftKey(email));
}

/** True when local draft may override server for this quoteId (same-tab recovery). */
export function shouldUseLocalQuoteDraft(
  email: string | null | undefined,
  quoteId: string,
): boolean {
  if (typeof window === 'undefined') return false;
  const id = quoteId?.trim();
  if (!id) return false;
  return sessionStorage.getItem(useLocalDraftKey(email)) === id;
}
