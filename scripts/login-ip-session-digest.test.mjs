import assert from "node:assert/strict";
import test from "node:test";

import {
  FDS_SESSION_CLOCK_SKEW_MS,
  FDS_SESSION_MAX_AGE_MS,
  FORCED_LOGOUT_MESSAGES,
  isFdsSessionExpired,
} from "../src/lib/fdsSessionPolicy.ts";
import {
  evaluateSessionState,
  extractClientIp,
  isSameAuthSignIn,
  isSessionExpired,
  normalizeIp,
  SESSION_CLOCK_SKEW_MS,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_SECONDS,
} from "../supabase/functions/_shared/sessionGuard.ts";

test("14-day session expiration policy matches on frontend and edge", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 1_209_600);
  assert.equal(FDS_SESSION_MAX_AGE_MS, SESSION_MAX_AGE_MS);
  assert.equal(FDS_SESSION_CLOCK_SKEW_MS, SESSION_CLOCK_SKEW_MS);

  const startMs = Date.UTC(2026, 10, 1, 0, 0, 0);
  const startIso = new Date(startMs).toISOString();

  assert.equal(isFdsSessionExpired(null, startMs + 1000), false);
  assert.equal(isFdsSessionExpired("not-a-date", startMs + 1000), false);
  assert.equal(isFdsSessionExpired(startIso, startMs + FDS_SESSION_MAX_AGE_MS), false);
  assert.equal(
    isFdsSessionExpired(startIso, startMs + FDS_SESSION_MAX_AGE_MS + FDS_SESSION_CLOCK_SKEW_MS),
    false,
  );
  assert.equal(
    isFdsSessionExpired(startIso, startMs + FDS_SESSION_MAX_AGE_MS + FDS_SESSION_CLOCK_SKEW_MS + 1),
    true,
  );
  assert.equal(
    isSessionExpired(startIso, startMs + SESSION_MAX_AGE_MS + SESSION_CLOCK_SKEW_MS + 1),
    true,
  );

  assert.ok(FORCED_LOGOUT_MESSAGES.ip_mismatch.title);
  assert.ok(FORCED_LOGOUT_MESSAGES.session_replaced.title);
  assert.ok(FORCED_LOGOUT_MESSAGES.session_expired.title);
});

test("extractClientIp prioritizes cf-connecting-ip, x-forwarded-for, then x-real-ip", () => {
  assert.equal(normalizeIp(" 203.0.113.5:43210 "), "203.0.113.5");
  assert.equal(normalizeIp("[2001:DB8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeIp("unknown"), null);

  const h1 = new Headers({
    "cf-connecting-ip": "198.51.100.10",
    "x-forwarded-for": "203.0.113.1, 10.0.0.1",
    "x-real-ip": "192.0.2.5",
  });
  assert.equal(extractClientIp(h1), "198.51.100.10");

  const h2 = new Headers({
    "x-forwarded-for": "unknown, 203.0.113.22:8080, 10.0.0.2",
    "x-real-ip": "192.0.2.9",
  });
  assert.equal(extractClientIp(h2), "203.0.113.22");

  const h3 = new Headers({ "x-real-ip": "192.0.2.9" });
  assert.equal(extractClientIp(h3), "192.0.2.9");

  assert.equal(extractClientIp(new Headers()), null);
});

test("evaluateSessionState keeps a changed IP and still rejects replacement and 14-day expiry", () => {
  const nowMs = Date.UTC(2026, 10, 24, 2, 0, 0);
  const recentIso = new Date(nowMs - 3_600_000).toISOString();
  const expiredIso = new Date(nowMs - SESSION_MAX_AGE_MS - SESSION_CLOCK_SKEW_MS - 5000).toISOString();

  assert.deepEqual(
    evaluateSessionState({
      activeSession: {
        session_id: "sess-1",
        bound_ip: "203.0.113.10",
        session_started_at: recentIso,
      },
      requestSessionId: "sess-1",
      requestIp: "203.0.113.10",
      authLastSignInAt: recentIso,
      nowMs,
    }),
    { valid: true },
  );

  assert.deepEqual(
    evaluateSessionState({
      activeSession: {
        session_id: "sess-1",
        bound_ip: "203.0.113.10",
        session_started_at: recentIso,
      },
      requestSessionId: "sess-1",
      requestIp: "198.51.100.77",
      authLastSignInAt: recentIso,
      nowMs,
    }),
    { valid: true },
  );

  assert.equal(isSameAuthSignIn(recentIso, recentIso), true);
  assert.equal(isSameAuthSignIn(recentIso, expiredIso), false);

  assert.deepEqual(
    evaluateSessionState({
      activeSession: {
        session_id: "sess-2",
        bound_ip: "198.51.100.77",
        session_started_at: recentIso,
      },
      requestSessionId: "sess-1",
      requestIp: "203.0.113.10",
      authLastSignInAt: recentIso,
      nowMs,
    }),
    { valid: false, reason: "session_replaced" },
  );

  assert.deepEqual(
    evaluateSessionState({
      activeSession: null,
      requestSessionId: "sess-1",
      requestIp: "203.0.113.10",
      authLastSignInAt: recentIso,
      nowMs,
    }),
    { valid: false, reason: "session_replaced" },
  );

  assert.deepEqual(
    evaluateSessionState({
      activeSession: {
        session_id: "sess-1",
        bound_ip: "203.0.113.10",
        session_started_at: expiredIso,
      },
      requestSessionId: "sess-1",
      requestIp: "203.0.113.10",
      authLastSignInAt: recentIso,
      nowMs,
    }),
    { valid: false, reason: "session_expired" },
  );
});
