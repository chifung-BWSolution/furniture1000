/**
 * Weekly FDS login & IP security digest aggregation + BW Furniture branded email renderer.
 */

import {
  companyFooterText,
  EMAIL_FONT_STACK,
  renderBrandedEmail,
  renderDetailBox,
} from "./brandedEmail.ts";
import { escapeHtml } from "./escapeHtml.ts";
import { formatInternalEmailSubject } from "./internalEmailSubject.ts";

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = String(raw).trim();
  if (!value) return null;

  if (value.startsWith("[")) {
    const closeIdx = value.indexOf("]");
    if (closeIdx > 1) {
      value = value.slice(1, closeIdx);
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(":"));
  }

  value = value.trim().toLowerCase().slice(0, 128);
  if (!value || value === "unknown") return null;
  return value;
}

export interface LoginDigestLogRow {
  id?: string;
  user_id?: string | null;
  user_email?: string | null;
  user_name?: string | null;
  event?: string | null;
  login_method?: string | null;
  ip_address?: string | null;
  logged_at: string;
}

export interface AccountLoginDigest {
  accountKey: string;
  userId: string | null;
  name: string;
  email: string | null;
  loginCount: number;
  uniqueIpCount: number;
  ips: string[];
  forcedLogoutSessionReplacedCount: number;
  forcedLogoutIpMismatchCount: number;
  forcedLogoutSessionExpiredCount: number;
  lastLoginAt: string | null;
}

export interface WeeklyLoginDigestSummary {
  weekStartDate: string;
  weekEndDate: string;
  rangeStartIso: string;
  rangeEndIso: string;
  totalLogins: number;
  activeAccountsCount: number;
  multiIpAccountsCount: number;
  forcedLogoutSessionReplacedCount: number;
  forcedLogoutIpMismatchCount: number;
  forcedLogoutSessionExpiredCount: number;
  multiIpAccounts: AccountLoginDigest[];
  allAccounts: AccountLoginDigest[];
}

export interface WeeklyLoginDigestEmail {
  subject: string;
  html: string;
  text: string;
}

function formatUtcDateYmd(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatHkDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms + HK_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * Compute Monday 00:00 HKT .. next Monday 00:00 HKT (exclusive) for the previous full week,
 * or for a specified `weekStart` (YYYY-MM-DD).
 */
export function getWeeklyDigestRangeHk(options?: {
  now?: Date;
  weekStart?: string;
}): {
  weekStartDate: string;
  weekEndDate: string;
  rangeStartIso: string;
  rangeEndIso: string;
} {
  if (options?.weekStart) {
    const trimmed = options.weekStart.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      throw new Error(`Invalid week_start format (expected YYYY-MM-DD): ${trimmed}`);
    }
    const y = Number(match[1]);
    const m = Number(match[2]) - 1;
    const d = Number(match[3]);
    const hkStartMs = Date.UTC(y, m, d, 0, 0, 0, 0);
    const hkEndExclusiveMs = hkStartMs + 7 * DAY_MS;
    const hkEndInclusiveMs = hkStartMs + 6 * DAY_MS;
    return {
      weekStartDate: formatUtcDateYmd(hkStartMs),
      weekEndDate: formatUtcDateYmd(hkEndInclusiveMs),
      rangeStartIso: new Date(hkStartMs - HK_OFFSET_MS).toISOString(),
      rangeEndIso: new Date(hkEndExclusiveMs - HK_OFFSET_MS).toISOString(),
    };
  }

  const now = options?.now ?? new Date();
  const hkNow = new Date(now.getTime() + HK_OFFSET_MS);
  const dayOfWeek = hkNow.getUTCDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const daysSinceMonday = (dayOfWeek + 6) % 7;

  const currentWeekMondayHkMs = Date.UTC(
    hkNow.getUTCFullYear(),
    hkNow.getUTCMonth(),
    hkNow.getUTCDate() - daysSinceMonday,
    0,
    0,
    0,
    0,
  );
  const prevWeekMondayHkMs = currentWeekMondayHkMs - 7 * DAY_MS;
  const prevWeekSundayHkMs = currentWeekMondayHkMs - DAY_MS;

  return {
    weekStartDate: formatUtcDateYmd(prevWeekMondayHkMs),
    weekEndDate: formatUtcDateYmd(prevWeekSundayHkMs),
    rangeStartIso: new Date(prevWeekMondayHkMs - HK_OFFSET_MS).toISOString(),
    rangeEndIso: new Date(currentWeekMondayHkMs - HK_OFFSET_MS).toISOString(),
  };
}

export function aggregateWeeklyLoginLogs(
  rows: LoginDigestLogRow[],
  options: {
    weekStartDate: string;
    weekEndDate: string;
    rangeStartIso: string;
    rangeEndIso: string;
    nameByUserId?: Map<string, string>;
    nameByEmail?: Map<string, string>;
  },
): WeeklyLoginDigestSummary {
  const {
    weekStartDate,
    weekEndDate,
    rangeStartIso,
    rangeEndIso,
    nameByUserId,
    nameByEmail,
  } = options;

  interface MutableAccount {
    accountKey: string;
    userId: string | null;
    name: string;
    email: string | null;
    loginCount: number;
    ipSet: Set<string>;
    forcedLogoutSessionReplacedCount: number;
    forcedLogoutIpMismatchCount: number;
    forcedLogoutSessionExpiredCount: number;
    lastLoginAt: string | null;
  }

  const accounts = new Map<string, MutableAccount>();
  let totalLogins = 0;
  let forcedLogoutSessionReplacedCount = 0;
  let forcedLogoutIpMismatchCount = 0;
  let forcedLogoutSessionExpiredCount = 0;

  for (const row of rows) {
    const event = String(row.event ?? "login").trim();
    const userId = row.user_id?.trim() || null;
    const email = row.user_email?.trim().toLowerCase() || null;
    const accountKey = userId || email || row.user_name?.trim() || "unknown";

    const resolvedName =
      row.user_name?.trim() ||
      (userId ? nameByUserId?.get(userId)?.trim() : undefined) ||
      (email ? nameByEmail?.get(email)?.trim() : undefined) ||
      email ||
      userId ||
      "未知帳號";

    let acc = accounts.get(accountKey);
    if (!acc) {
      acc = {
        accountKey,
        userId,
        name: resolvedName,
        email,
        loginCount: 0,
        ipSet: new Set<string>(),
        forcedLogoutSessionReplacedCount: 0,
        forcedLogoutIpMismatchCount: 0,
        forcedLogoutSessionExpiredCount: 0,
        lastLoginAt: null,
      };
      accounts.set(accountKey, acc);
    } else {
      if (resolvedName && (acc.name === acc.email || acc.name === acc.userId || acc.name === "未知帳號")) {
        acc.name = resolvedName;
      }
      if (!acc.email && email) acc.email = email;
      if (!acc.userId && userId) acc.userId = userId;
    }

    if (event === "login") {
      totalLogins += 1;
      acc.loginCount += 1;
      const ip = normalizeIp(row.ip_address);
      if (ip) acc.ipSet.add(ip);

      const rowMs = Date.parse(row.logged_at);
      const prevMs = acc.lastLoginAt ? Date.parse(acc.lastLoginAt) : Number.NaN;
      if (Number.isFinite(rowMs) && (!Number.isFinite(prevMs) || rowMs > prevMs)) {
        acc.lastLoginAt = row.logged_at;
      }
    } else if (event === "forced_logout_session_replaced") {
      forcedLogoutSessionReplacedCount += 1;
      acc.forcedLogoutSessionReplacedCount += 1;
    } else if (event === "forced_logout_ip_mismatch") {
      forcedLogoutIpMismatchCount += 1;
      acc.forcedLogoutIpMismatchCount += 1;
    } else if (event === "forced_logout_session_expired") {
      forcedLogoutSessionExpiredCount += 1;
      acc.forcedLogoutSessionExpiredCount += 1;
    }
  }

  const allAccounts: AccountLoginDigest[] = [...accounts.values()]
    .filter(
      (a) =>
        a.loginCount > 0 ||
        a.forcedLogoutSessionReplacedCount > 0 ||
        a.forcedLogoutIpMismatchCount > 0 ||
        a.forcedLogoutSessionExpiredCount > 0,
    )
    .map((a) => ({
      accountKey: a.accountKey,
      userId: a.userId,
      name: a.name,
      email: a.email,
      loginCount: a.loginCount,
      uniqueIpCount: a.ipSet.size,
      ips: [...a.ipSet],
      forcedLogoutSessionReplacedCount: a.forcedLogoutSessionReplacedCount,
      forcedLogoutIpMismatchCount: a.forcedLogoutIpMismatchCount,
      forcedLogoutSessionExpiredCount: a.forcedLogoutSessionExpiredCount,
      lastLoginAt: a.lastLoginAt,
    }))
    .sort((a, b) => {
      if (b.uniqueIpCount !== a.uniqueIpCount) return b.uniqueIpCount - a.uniqueIpCount;
      if (b.loginCount !== a.loginCount) return b.loginCount - a.loginCount;
      return (a.email ?? a.name).localeCompare(b.email ?? b.name);
    });

  const multiIpAccounts = allAccounts.filter((a) => a.uniqueIpCount >= 2);
  const activeAccountsCount = allAccounts.filter((a) => a.loginCount > 0).length;

  return {
    weekStartDate,
    weekEndDate,
    rangeStartIso,
    rangeEndIso,
    totalLogins,
    activeAccountsCount,
    multiIpAccountsCount: multiIpAccounts.length,
    forcedLogoutSessionReplacedCount,
    forcedLogoutIpMismatchCount,
    forcedLogoutSessionExpiredCount,
    multiIpAccounts,
    allAccounts,
  };
}

function renderAccountLabelHtml(acc: AccountLoginDigest): string {
  const primary = escapeHtml(acc.name);
  if (acc.email && acc.email.toLowerCase() !== acc.name.toLowerCase()) {
    return `<div style="font-weight:600;color:#0F1B3D;">${primary}</div><div style="font-size:12px;color:#64748B;word-break:break-word;">${escapeHtml(acc.email)}</div>`;
  }
  return `<div style="font-weight:600;color:#0F1B3D;word-break:break-word;">${primary}</div>`;
}

function renderIpBadgesHtml(ips: string[], highlightMulti: boolean): string {
  if (ips.length === 0) {
    return `<span style="color:#94A3B8;">—（舊紀錄或未記錄 IP）</span>`;
  }
  const bg = highlightMulti ? "#FFF7ED" : "#F1F5FC";
  const border = highlightMulti ? "#FDBA74" : "#DCE6F9";
  const color = highlightMulti ? "#9A3412" : "#1E3A8A";
  return ips
    .map(
      (ip) =>
        `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;border-radius:6px;background-color:${bg};border:1px solid ${border};font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${color};">${escapeHtml(ip)}</span>`,
    )
    .join("");
}

function renderMultiIpSectionHtml(multiIpAccounts: AccountLoginDigest[]): string {
  if (multiIpAccounts.length === 0) {
    return `<div style="margin-top:28px;padding:16px 20px;border-radius:12px;background-color:#ECFDF5;border:1px solid #A7F3D0;font-family:${EMAIL_FONT_STACK};font-size:14px;line-height:1.65;color:#065F46;">
      <strong>多 IP 登入檢查：</strong>本週未發現同一帳號於多個 IP 登入的紀錄。
    </div>`;
  }

  const rowsHtml = multiIpAccounts
    .map(
      (acc) => `<tr>
        <td valign="top" style="padding:12px 10px;border-top:1px solid #FED7AA;font-family:${EMAIL_FONT_STACK};font-size:13.5px;line-height:1.5;">${renderAccountLabelHtml(acc)}</td>
        <td valign="top" align="right" style="padding:12px 8px;border-top:1px solid #FED7AA;font-family:${EMAIL_FONT_STACK};font-size:13.5px;font-weight:700;color:#9A3412;white-space:nowrap;">${acc.loginCount}</td>
        <td valign="top" align="right" style="padding:12px 8px;border-top:1px solid #FED7AA;font-family:${EMAIL_FONT_STACK};font-size:13.5px;font-weight:700;color:#C2410C;white-space:nowrap;">${acc.uniqueIpCount}</td>
        <td valign="top" style="padding:12px 10px;border-top:1px solid #FED7AA;font-family:${EMAIL_FONT_STACK};font-size:12.5px;line-height:1.6;">${renderIpBadgesHtml(acc.ips, true)}</td>
        <td valign="top" style="padding:12px 10px;border-top:1px solid #FED7AA;font-family:${EMAIL_FONT_STACK};font-size:12.5px;color:#7C2D12;white-space:nowrap;">${escapeHtml(formatHkDateTime(acc.lastLoginAt))}</td>
      </tr>`,
    )
    .join("");

  return `<div style="margin-top:28px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:16px;font-weight:700;color:#9A3412;margin-bottom:10px;">
      多 IP 登入帳號明細（≥ 2 個不同 IP，共 ${multiIpAccounts.length} 個帳號）
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#FFF7ED;border:1px solid #FDBA74;border-radius:12px;border-collapse:separate;">
      <thead>
        <tr>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#9A3412;">帳號</th>
          <th align="right" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#9A3412;white-space:nowrap;">登入次數</th>
          <th align="right" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#9A3412;white-space:nowrap;">不同 IP 數</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#9A3412;">IP 清單</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#9A3412;white-space:nowrap;">最後登入 (HKT)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

function formatForcedParts(acc: AccountLoginDigest): string {
  const parts: string[] = [];
  if (acc.forcedLogoutSessionReplacedCount > 0) {
    parts.push(`他處取代 ${acc.forcedLogoutSessionReplacedCount}`);
  }
  if (acc.forcedLogoutSessionExpiredCount > 0) {
    parts.push(`14 日到期 ${acc.forcedLogoutSessionExpiredCount}`);
  }
  if (acc.forcedLogoutIpMismatchCount > 0) {
    parts.push(`舊規則 IP ${acc.forcedLogoutIpMismatchCount}`);
  }
  return parts.length > 0 ? parts.join(" / ") : "—";
}

function renderAllAccountsSectionHtml(allAccounts: AccountLoginDigest[]): string {
  if (allAccounts.length === 0) {
    return `<div style="margin-top:28px;padding:18px 20px;border-radius:12px;background-color:#F8FAFC;border:1px solid #E2E8F0;font-family:${EMAIL_FONT_STACK};font-size:14px;color:#64748B;text-align:center;">
      本週尚無登入紀錄。
    </div>`;
  }

  const rowsHtml = allAccounts
    .map((acc) => {
      const forcedLabel = formatForcedParts(acc);
      const isMulti = acc.uniqueIpCount >= 2;
      return `<tr>
        <td valign="top" style="padding:11px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:13.5px;line-height:1.5;">${renderAccountLabelHtml(acc)}</td>
        <td valign="top" align="right" style="padding:11px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:13.5px;font-weight:600;color:#0F1B3D;white-space:nowrap;">${acc.loginCount}</td>
        <td valign="top" align="right" style="padding:11px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:13.5px;font-weight:700;color:${isMulti ? "#C2410C" : "#0F1B3D"};white-space:nowrap;">${acc.uniqueIpCount}</td>
        <td valign="top" style="padding:11px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12.5px;line-height:1.6;">${renderIpBadgesHtml(acc.ips, isMulti)}</td>
        <td valign="top" style="padding:11px 8px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12px;color:#64748B;white-space:nowrap;">${escapeHtml(forcedLabel)}</td>
        <td valign="top" style="padding:11px 10px;border-top:1px solid #E9EDF5;font-family:${EMAIL_FONT_STACK};font-size:12.5px;color:#475569;white-space:nowrap;">${escapeHtml(formatHkDateTime(acc.lastLoginAt))}</td>
      </tr>`;
    })
    .join("");

  return `<div style="margin-top:30px;">
    <div style="font-family:${EMAIL_FONT_STACK};font-size:16px;font-weight:700;color:#0E1B3A;margin-bottom:10px;">
      所有帳號登入統計（共 ${allAccounts.length} 個帳號）
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#FFFFFF;border:1px solid #E5EAF3;border-radius:12px;border-collapse:separate;">
      <thead>
        <tr style="background-color:#F5F9FF;">
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;">帳號</th>
          <th align="right" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">登入次數</th>
          <th align="right" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">不同 IP 數</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;">IP 清單</th>
          <th align="left" style="padding:10px 8px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">強制登出</th>
          <th align="left" style="padding:10px 10px;font-family:${EMAIL_FONT_STACK};font-size:12px;font-weight:700;color:#475569;white-space:nowrap;">最後登入 (HKT)</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>`;
}

export function buildWeeklyLoginDigestEmail(
  summary: WeeklyLoginDigestSummary,
  options?: { isTest?: boolean },
): WeeklyLoginDigestEmail {
  const periodLabel = `${summary.weekStartDate} 至 ${summary.weekEndDate}（HKT）`;
  const multiSuffix =
    summary.multiIpAccountsCount > 0
      ? `｜${summary.multiIpAccountsCount} 個多 IP 帳號`
      : "";
  const subject = formatInternalEmailSubject(
    `每週登入安全報告（${summary.weekStartDate} 至 ${summary.weekEndDate}）${multiSuffix}`,
    { isTest: options?.isTest },
  );

  const preheader = `統計週期 ${periodLabel}：總登入 ${summary.totalLogins} 次、活躍帳號 ${summary.activeAccountsCount} 個、多 IP 帳號 ${summary.multiIpAccountsCount} 個。`;
  const heading = "FDS 每週登入安全報告";
  const subheading = `統計週期：${periodLabel}`;

  const forcedSummaryValue =
    `他處登入取代 ${summary.forcedLogoutSessionReplacedCount} 次 ／ 14 日到期 ${summary.forcedLogoutSessionExpiredCount} 次` +
    (summary.forcedLogoutIpMismatchCount > 0
      ? `（舊規則 IP ${summary.forcedLogoutIpMismatchCount} 次）`
      : "");

  const kpiBox = renderDetailBox([
    { label: "統計週期", value: periodLabel },
    { label: "總登入次數", value: `${summary.totalLogins} 次` },
    { label: "活躍帳號數", value: `${summary.activeAccountsCount} 個` },
    {
      label: "多 IP 帳號",
      value: `${summary.multiIpAccountsCount} 個（≥ 2 個不同 IP）`,
    },
    {
      label: "強制登出統計",
      value: forcedSummaryValue,
    },
  ]);

  const contentHtml = `${kpiBox}
    ${renderMultiIpSectionHtml(summary.multiIpAccounts)}
    ${renderAllAccountsSectionHtml(summary.allAccounts)}`;

  const noteHtml =
    "系統規則：同一 Session 來源 IP 變更只更新登入紀錄，不強制登出；同一帳號於其他位置新登入會取代舊 Session；所有 Session 超過 14 日自動到期登出。本報告由 FDS 安全排程於每週一 10:00 HKT 自動發送。";

  const html = renderBrandedEmail({
    locale: "zh-Hant",
    preheader,
    heading,
    subheading,
    contentHtml,
    noteHtml,
  });

  const textLines: string[] = [
    heading,
    `統計週期：${periodLabel}`,
    "",
    `總登入次數：${summary.totalLogins} 次`,
    `活躍帳號數：${summary.activeAccountsCount} 個`,
    `多 IP 帳號（≥ 2 個不同 IP）：${summary.multiIpAccountsCount} 個`,
    `強制登出統計：${forcedSummaryValue}`,
    "",
    "--- 多 IP 登入帳號明細（≥ 2 個不同 IP） ---",
  ];

  if (summary.multiIpAccounts.length === 0) {
    textLines.push("本週未發現同一帳號於多個 IP 登入的紀錄。");
  } else {
    for (const acc of summary.multiIpAccounts) {
      const identity = acc.email ? `${acc.name} <${acc.email}>` : acc.name;
      textLines.push(
        `- ${identity}｜登入 ${acc.loginCount} 次｜不同 IP ${acc.uniqueIpCount} 個 [${acc.ips.join(", ")}]｜最後登入 ${formatHkDateTime(acc.lastLoginAt)}`,
      );
    }
  }

  textLines.push("", "--- 所有帳號登入統計 ---");
  if (summary.allAccounts.length === 0) {
    textLines.push("本週尚無登入紀錄。");
  } else {
    for (const acc of summary.allAccounts) {
      const identity = acc.email ? `${acc.name} <${acc.email}>` : acc.name;
      const ipList = acc.ips.length > 0 ? acc.ips.join(", ") : "—";
      textLines.push(
        `- ${identity}｜登入 ${acc.loginCount} 次｜不同 IP ${acc.uniqueIpCount} 個 [${ipList}]｜強制登出：${formatForcedParts(acc)}｜最後登入 ${formatHkDateTime(acc.lastLoginAt)}`,
      );
    }
  }

  textLines.push("", noteHtml, "", companyFooterText("zh-Hant"));

  return {
    subject,
    html,
    text: textLines.join("\n"),
  };
}
