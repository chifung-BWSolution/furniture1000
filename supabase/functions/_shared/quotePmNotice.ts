/** Shared subject, heading, and greeting for PM quote notifications. */

import { formatInternalEmailSubject } from "./internalEmailSubject.ts";

export function pmNoticeTitle(
  pmName: string | null | undefined,
  quoteId: string,
  action: string,
  version?: string | null,
): string {
  const who = String(pmName ?? "").trim() || "同事";
  const ver = String(version ?? "").trim();
  return formatInternalEmailSubject(`${quoteId}${ver ? ` ${ver}` : ""} ${action}`, {
    tag: who,
  });
}

export function pmNoticeGreeting(pmName: string | null | undefined): string {
  const who = String(pmName ?? "").trim();
  return who ? `Dear 同事 ${who}，` : "Dear 同事，";
}
