/**
 * Pure IP extraction, 14-day session expiration, and IP/session verification helpers.
 * Shared between Edge Functions and unit tests.
 */

export const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60; // 1,209,600s (14 days)
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;
export const SESSION_CLOCK_SKEW_MS = 60 * 1000;

export type SessionInvalidReason =
  | "session_expired"
  | "session_replaced"
  | "ip_mismatch";

export interface ActiveSessionRecord {
  session_id: string;
  bound_ip: string | null;
  session_started_at: string;
}

export type SessionEvaluationResult =
  | { valid: true }
  | { valid: false; reason: SessionInvalidReason };

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = String(raw).trim();
  if (!value) return null;

  // Bracketed IPv6, optionally with :port (e.g. "[2001:db8::1]:443")
  if (value.startsWith("[")) {
    const closeIdx = value.indexOf("]");
    if (closeIdx > 1) {
      value = value.slice(1, closeIdx);
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    // IPv4 with port (e.g. "203.0.113.5:54321")
    value = value.slice(0, value.lastIndexOf(":"));
  }

  value = value.trim().toLowerCase();
  if (!value || value === "unknown") return null;
  return value;
}

export function extractClientIp(headers: Headers): string | null {
  const cfIp = normalizeIp(headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    for (const part of xff.split(",")) {
      const normalized = normalizeIp(part);
      if (normalized) return normalized;
    }
  }

  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;

  return null;
}

export function isSessionExpired(
  startedAtIso: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!startedAtIso) return false;
  const startedMs = Date.parse(startedAtIso);
  if (!Number.isFinite(startedMs)) return false;
  return nowMs - startedMs > SESSION_MAX_AGE_MS + SESSION_CLOCK_SKEW_MS;
}

export function evaluateSessionState(params: {
  activeSession: ActiveSessionRecord | null;
  requestSessionId: string | null;
  requestIp: string | null;
  authLastSignInAt: string | null;
  nowMs?: number;
}): SessionEvaluationResult {
  const nowMs = params.nowMs ?? Date.now();
  const { activeSession, requestSessionId, requestIp, authLastSignInAt } = params;

  if (
    isSessionExpired(activeSession?.session_started_at, nowMs) ||
    isSessionExpired(authLastSignInAt, nowMs)
  ) {
    return { valid: false, reason: "session_expired" };
  }

  const trimmedReqSessionId = requestSessionId?.trim() || null;

  if (!activeSession) {
    if (trimmedReqSessionId) {
      return { valid: false, reason: "session_replaced" };
    }
    return { valid: true };
  }

  if (trimmedReqSessionId && activeSession.session_id !== trimmedReqSessionId) {
    return { valid: false, reason: "session_replaced" };
  }

  const normalizedBoundIp = normalizeIp(activeSession.bound_ip);
  const normalizedRequestIp = normalizeIp(requestIp);
  if (normalizedBoundIp && normalizedRequestIp && normalizedBoundIp !== normalizedRequestIp) {
    return { valid: false, reason: "ip_mismatch" };
  }

  return { valid: true };
}
