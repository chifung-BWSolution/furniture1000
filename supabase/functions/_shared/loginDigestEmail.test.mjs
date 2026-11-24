import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateWeeklyLoginLogs,
  buildWeeklyLoginDigestEmail,
  getWeeklyDigestRangeHk,
} from "./loginDigestEmail.ts";

test("computes previous Monday-to-Sunday HKT range", () => {
  const range = getWeeklyDigestRangeHk({ now: new Date("2026-11-23T02:00:00Z") });
  assert.equal(range.weekStartDate, "2026-11-16");
  assert.equal(range.weekEndDate, "2026-11-22");
  assert.equal(range.rangeStartIso, "2026-11-15T16:00:00.000Z");
  assert.equal(range.rangeEndIso, "2026-11-22T16:00:00.000Z");
});

test("aggregates multi-IP logins, session replacement, and expiry with [FDS] subject", () => {
  const range = getWeeklyDigestRangeHk({ weekStart: "2026-11-16" });
  const summary = aggregateWeeklyLoginLogs(
    [
      {
        user_id: "u1",
        user_email: "alice@bwteam.hk",
        user_name: "Alice",
        event: "login",
        ip_address: "203.0.113.10",
        logged_at: "2026-11-16T01:00:00Z",
      },
      {
        user_id: "u1",
        user_email: "alice@bwteam.hk",
        user_name: "Alice",
        event: "login",
        ip_address: "198.51.100.8",
        logged_at: "2026-11-17T01:00:00Z",
      },
      {
        user_id: "u1",
        user_email: "alice@bwteam.hk",
        user_name: "Alice",
        event: "forced_logout_session_replaced",
        ip_address: "198.51.100.8",
        logged_at: "2026-11-17T02:00:00Z",
      },
      {
        user_id: "u2",
        user_email: "bob@bwteam.hk",
        user_name: "Bob",
        event: "forced_logout_session_expired",
        ip_address: "203.0.113.10",
        logged_at: "2026-11-18T02:00:00Z",
      },
    ],
    range,
  );

  assert.equal(summary.totalLogins, 2);
  assert.equal(summary.activeAccountsCount, 1);
  assert.equal(summary.multiIpAccountsCount, 1);
  assert.equal(summary.forcedLogoutSessionReplacedCount, 1);
  assert.equal(summary.forcedLogoutSessionExpiredCount, 1);
  assert.equal(summary.forcedLogoutIpMismatchCount, 0);

  const email = buildWeeklyLoginDigestEmail(summary);
  assert.match(email.subject, /^【FDS】每週登入安全報告（2026-11-16 至 2026-11-22）/);
  assert.match(email.html, /他處登入取代 1 次/);
  assert.match(email.html, /來源 IP 變更只更新登入紀錄，不強制登出/);
  assert.match(email.text, /他處登入取代 1 次/);
});
