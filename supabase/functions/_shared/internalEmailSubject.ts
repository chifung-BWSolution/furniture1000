/** Shared subject formatter for all FDS internal emails. */

export function formatInternalEmailSubject(
  title: string,
  options?: { tag?: string | null; isTest?: boolean },
): string {
  const prefix = options?.isTest ? "FDS 測試" : "FDS";
  const tag = String(options?.tag ?? "").trim();
  const cleanTitle = String(title ?? "").trim();
  return tag ? `【${prefix}｜${tag}】${cleanTitle}` : `【${prefix}】${cleanTitle}`;
}
