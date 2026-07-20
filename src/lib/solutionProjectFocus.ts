/** Pass selected design project id between 方案列表 → 設計專案 (session only). */
const KEY = 'fds-solution-focus-project';

export function writeSolutionFocusProjectId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (!id) {
    sessionStorage.removeItem(KEY);
    return;
  }
  sessionStorage.setItem(KEY, id);
}

export function consumeSolutionFocusProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  return id?.trim() || null;
}

export function readSolutionFocusProjectId(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(KEY)?.trim() || null;
}
