export const FDS_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const FDS_SESSION_CLOCK_SKEW_MS = 60 * 1000;

export type ForcedLogoutReason =
  | 'ip_mismatch'
  | 'session_replaced'
  | 'session_expired';

export const FORCED_LOGOUT_MESSAGES: Record<
  ForcedLogoutReason,
  { title: string; description: string }
> = {
  ip_mismatch: {
    title: '偵測到連線 IP 變更，已安全登出',
    description: '系統偵測到您目前的網路 IP 與登入時不同，為保護帳號安全已自動登出，請重新登入。',
  },
  session_replaced: {
    title: '您的帳號已在其他位置或 IP 重新登入',
    description: '同一帳號僅保留最新一次登入階段，目前視窗已登出，請重新登入以繼續使用。',
  },
  session_expired: {
    title: '登入狀態已達 14 日安全期限',
    description: '為確保平台資料安全，系統每 14 日需重新驗證身分一次，請重新登入。',
  },
};

export function isFdsSessionExpired(
  startedAtIso: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!startedAtIso) return false;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedMs)) return false;
  return nowMs - startedMs > FDS_SESSION_MAX_AGE_MS + FDS_SESSION_CLOCK_SKEW_MS;
}
