/**
 * 報價一覽倒數：每張報價由建立日期起計 45 日。
 * 超過 45 日仍未成功，該報價視為不成功（不再顯示負數天數）。
 * PMS 已有結果的提案（Confirmed Project／Case Closed）以階段為準，不再單靠日數判斷。
 */
export const QUOTE_COUNTDOWN_DAYS = 45;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 剩餘日數（無條件進位）。開始當日為 `days`，第 `days` 日完結後回傳 0 或負數。
 * 日期缺失或無效時回傳 null。
 */
export function countdownRemainingDays(
  startedAt: string | null | undefined,
  days: number = QUOTE_COUNTDOWN_DAYS,
  now: Date = new Date(),
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt);
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) return null;
  const deadline = startMs + days * DAY_MS;
  return Math.ceil((deadline - now.getTime()) / DAY_MS);
}

/** 報價由建立日期起計 45 日的剩餘日數。 */
export function quoteRemainingDays(
  createdAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  return countdownRemainingDays(createdAt, QUOTE_COUNTDOWN_DAYS, now);
}

/** 已過 45 日倒數期限；日期缺失時不當作不成功。 */
export function isQuoteUnsuccessful(remainingDays: number | null): boolean {
  return remainingDays !== null && remainingDays <= 0;
}

const WON_STAGE_RE = /^(confirmed(\s*project)?|won|得標|已確認|成功)$/i;
const CLOSED_STAGE_RE = /^(case\s*closed|closed|lost|結案|失敗|不成功)$/i;

/** PMS 提案階段是否已成功（例如 Confirmed Project）。 */
export function isWonPitchingStage(
  stage: string | null | undefined,
): boolean {
  const s = stage?.trim();
  if (!s) return false;
  return WON_STAGE_RE.test(s);
}

/** PMS 提案階段是否已結案／失敗（例如 Case Closed）。 */
export function isClosedPitchingStage(
  stage: string | null | undefined,
): boolean {
  const s = stage?.trim();
  if (!s) return false;
  return !isWonPitchingStage(s) && CLOSED_STAGE_RE.test(s);
}

export type QuoteCountdownOutcome = 'won' | 'unsuccessful' | 'active';

/**
 * 倒數結果：PMS 已成功（Confirmed Project）優先，其次已結案；
 * 其餘才看 45 日倒數是否用完。
 */
export function quoteCountdownOutcome(
  stage: string | null | undefined,
  remainingDays: number | null,
): QuoteCountdownOutcome {
  if (isWonPitchingStage(stage)) return 'won';
  if (isClosedPitchingStage(stage)) return 'unsuccessful';
  return isQuoteUnsuccessful(remainingDays) ? 'unsuccessful' : 'active';
}

/**
 * PMS `Recover Pitching` 會把階段改回 Enquiry，但保留 `enquiry_date`；
 * 復原時間只寫入 `modified_date`。原本 45 日已過的話，由 `modified_date`
 * 重新起算。未過原期限、已成功或已結案時回傳 null。
 */
export function pitchingReopenedAt(
  enquiryDate: string | null | undefined,
  modifiedDate: string | null | undefined,
  stage: string | null | undefined,
): string | null {
  if (!enquiryDate || !modifiedDate) return null;
  if (isWonPitchingStage(stage) || isClosedPitchingStage(stage)) return null;
  const start = new Date(enquiryDate).getTime();
  const modified = new Date(modifiedDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(modified)) return null;
  return modified > start + QUOTE_COUNTDOWN_DAYS * DAY_MS
    ? modifiedDate
    : null;
}

/** PMS 提案倒數起點：原 `enquiry_date`，或復原後的 `modified_date`。 */
export function pitchingCountdownStart(
  enquiryDate: string | null | undefined,
  modifiedDate: string | null | undefined,
  stage: string | null | undefined,
): string | null {
  return (
    pitchingReopenedAt(enquiryDate, modifiedDate, stage) ||
    enquiryDate ||
    null
  );
}

/**
 * 報價倒數起點：報價建立日期，或較遲的 PMS 提案復原日期。
 * 報價在復原後才建立時，仍以報價建立日期為準。
 */
export function quoteCountdownStart(
  quoteCreatedAt: string | null | undefined,
  pitching:
    | {
        enquiry_date?: string | null;
        modified_date?: string | null;
        pitching_stages?: string | null;
      }
    | null
    | undefined,
): string | null {
  const base = quoteCreatedAt || null;
  const reopened = pitching
    ? pitchingReopenedAt(
        pitching.enquiry_date,
        pitching.modified_date,
        pitching.pitching_stages,
      )
    : null;
  if (!base) return reopened;
  if (!reopened) return base;
  const baseMs = new Date(base).getTime();
  const reopenedMs = new Date(reopened).getTime();
  if (!Number.isFinite(baseMs)) return reopened;
  if (!Number.isFinite(reopenedMs)) return base;
  return reopenedMs > baseMs ? reopened : base;
}
