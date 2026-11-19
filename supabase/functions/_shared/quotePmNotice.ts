/** Shared subject, heading, and greeting for PM quote notifications. */

export function pmNoticeTitle(
  pmName: string | null | undefined,
  quoteId: string,
  action: string,
  version?: string | null,
): string {
  const who = String(pmName ?? "").trim() || "同事";
  const ver = String(version ?? "").trim();
  return `【${who}】${quoteId}${ver ? ` ${ver}` : ""} ${action}`;
}

export function pmNoticeGreeting(pmName: string | null | undefined): string {
  const who = String(pmName ?? "").trim();
  return who ? `Dear 同事 ${who}，` : "Dear 同事，";
}
