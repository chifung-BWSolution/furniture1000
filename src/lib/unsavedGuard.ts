import { QUOTE_UNSAVED_LEAVE_MESSAGE } from '@/lib/quickQuoteSession';

// Lightweight module-level guard for unsaved work that should block navigation.
// The quote draft editor (生成報價單) registers a dirty flag here; AppShell checks
// it before switching views, and a beforeunload listener warns on tab close.
let dirty = false;
let message = QUOTE_UNSAVED_LEAVE_MESSAGE;
let leaveHandler: (() => void) | null = null;
let draftFlushHandler: (() => Promise<void>) | null = null;

export const unsavedGuard = {
  get isDirty() {
    return dirty;
  },
  get message() {
    return message;
  },
  set(value: boolean, msg?: string) {
    dirty = value;
    if (msg) message = msg;
  },
  setLeaveHandler(handler: (() => void) | null) {
    leaveHandler = handler;
  },
  /** Register async IndexedDB flush (called before voluntary reload / update banner). */
  setDraftFlushHandler(handler: (() => Promise<void>) | null) {
    draftFlushHandler = handler;
  },
  async flushDraft(): Promise<void> {
    if (!draftFlushHandler) return;
    await draftFlushHandler();
  },
  /** Returns true if navigation may proceed. */
  confirmLeave(): boolean {
    if (!dirty) return true;
    const ok = window.confirm(message);
    if (ok) {
      leaveHandler?.();
      dirty = false;
      leaveHandler = null;
    }
    return ok;
  },
  /** Clear dirty state only — keep leaveHandler / flushHandler for later edits. */
  clear() {
    dirty = false;
  },
};
