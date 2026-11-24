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
  isSessionExpired,
  normalizeIp,
  SESSION_CLOCK_SKEW_MS,
  SESSION_MAX_AGE_MS,
  SESSION_MAX_AGE_SECONDS,
} from "../supabase/functions/_shared/sessionGuard.ts";
import {
  aggregateWeeklyLoginLogs,
  buildWeeklyLoginDigestEmail,
  getWeeklyDigestRangeHk,
} from "../supabase/functions/_shared/loginDigestEmail.ts";
import { formatInternalEmailSubject } from "../supabase/functions/_shared/internalEmailSubject.ts";

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

test("evaluateSessionState detects matching session, IP mismatch, replacement, and 14-day expiry", () => {
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
    { valid: false, reason: "ip_mismatch" },
  );

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

test("getWeeklyDigestRangeHk computes previous Monday-Sunday in Asia/Hong_Kong", () => {
  // Monday 2026-11-23 10:00:00 HKT == 2026-11-23 02:00:00 UTC
  const mondayMorningHk = new Date("2026-11-23T02:00:00.000Z");
  const range = getWeeklyDigestRangeHk({ now: mondayMorningHk });
  assert.equal(range.weekStartDate, "2026-11-16");
  assert.equal(range.weekEndDate, "2026-11-22");
  assert.equal(range.rangeStartIso, "2026-11-15T16:00:00.000Z");
  assert.equal(range.rangeEndIso, "2026-11-22T16:00:00.000Z");
});

test("aggregateWeeklyLoginLogs and buildWeeklyLoginDigestEmail flag >= 2 unique IPs with BW branding", () => {
  const range = getWeeklyDigestRangeHk({ weekStart: "2026-11-16" });
  const summary = aggregateWeeklyLoginLogs(
    [
      {
        user_id: "u1",
        user_email: "alice@example.com",
        user_name: "Alice <Admin>",
        event: "login",
        ip_address: "203.0.113.1",
        logged_at: "2026-11-16T01:30:00.000Z",
      },
      {
        user_id: "u1",
        user_email: "alice@example.com",
        user_name: "Alice <Admin>",
        event: "login",
        ip_address: "198.51.100.22",
        logged_at: "2026-11-17T03:00:00.000Z",
      },
      {
        user_id: "u1",
        user_email: "alice@example.com",
        user_name: "Alice <Admin>",
        event: "forced_logout_ip_mismatch",
        ip_address: "198.51.100.22",
        logged_at: "2026-11-17T03:10:00.000Z",
      },
      {
        user_id: "u2",
        user_email: "bob@example.com",
        user_name: "Bob",
        event: "login",
        ip_address: "192.0.2.8",
        logged_at: "2026-11-18T05:00:00.000Z",
      },
      {
        user_id: "u2",
        user_email: "bob@example.com",
        user_name: "Bob",
        event: "login",
        ip_address: "192.0.2.8",
        logged_at: "2026-11-19T05:00:00.000Z",
      },
    ],
    range,
  );

  assert.equal(summary.totalLogins, 4);
  assert.equal(summary.activeAccountsCount, 2);
  assert.equal(summary.multiIpAccountsCount, 1);
  assert.equal(summary.forcedLogoutIpMismatchCount, 1);
  assert.equal(summary.multiIpAccounts[0].email, "alice@example.com");
  assert.equal(summary.multiIpAccounts[0].uniqueIpCount, 2);

  const email = buildWeeklyLoginDigestEmail(summary);
  assert.equal(
    email.subject,
    "【FDS】每週登入安全報告（2026-11-16 至 2026-11-22）｜1 個多 IP 帳號",
  );
  assert.match(email.html, /https:\/\/www\.bwteam-furniture\.com\/assets\/bwf-logo\.png/);
  assert.match(email.html, /#2F6BED/);
  assert.match(email.html, /Alice &lt;Admin&gt;/);
  assert.match(email.html, /203\.0\.113\.1/);
  assert.match(email.html, /198\.51\.100\.22/);
  assert.match(email.html, /192\.0\.2\.8/);
  assert.match(email.html, /Room D-G, 5\/F, Wah Lik Industrial Centre/);
  assert.match(email.text, /多 IP 登入帳號明細/);
  assert.match(email.text, /alice@example\.com/);
  assert.match(email.text, /BW Furniture/);
});

test("buildWeeklyLoginDigestEmail renders clean state when no multi-IP accounts exist", () => {
  const range = getWeeklyDigestRangeHk({ weekStart: "2026-11-16" });
  const summary = aggregateWeeklyLoginLogs([], range);
  const email = buildWeeklyLoginDigestEmail(summary);
  assert.equal(email.subject, "【FDS】每週登入安全報告（2026-11-16 至 2026-11-22）");
  assert.doesNotMatch(email.subject, /多 IP 帳號/);
  assert.match(email.html, /本週未發現同一帳號於多個 IP 登入的異常紀錄/);
  assert.match(email.html, /本週尚無登入紀錄/);
  assert.match(email.text, /本週未發現同一帳號於多個 IP 登入的異常紀錄/);
});

test("formatInternalEmailSubject unifies FDS internal email prefixes", () => {
  assert.equal(
    formatInternalEmailSubject("Shopify 上載產品紀錄 2026/11/24（香港時間）"),
    "【FDS】Shopify 上載產品紀錄 2026/11/24（香港時間）",
  );
  assert.equal(
    formatInternalEmailSubject("Shopify 上載產品紀錄 2026/11/24（香港時間）", { isTest: true }),
    "【FDS 測試】Shopify 上載產品紀錄 2026/11/24（香港時間）",
  );
  assert.equal(
    formatInternalEmailSubject("BWF-FD26-001 客戶已查看報價", { tag: "Franco" }),
    "【FDS｜Franco】BWF-FD26-001 客戶已查看報價",
  );
});
