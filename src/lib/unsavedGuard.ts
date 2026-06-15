// Lightweight module-level guard for unsaved work that should block navigation.
// The quote draft editor (生成報價單) registers a dirty flag here; AppShell checks
// it before switching views, and a beforeunload listener warns on tab close.
let dirty = false;
let message = '您有未儲存的內容，確定要離開嗎？';

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
  clear() {
    dirty = false;
  },
};
