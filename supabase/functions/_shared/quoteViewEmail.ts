/**
 * Branded email for the FDS-14 "customer viewed the quotation" notification.
 *
 * Layout is table-based and every rule is inline: Gmail and Outlook drop most
 * `<style>` blocks, flex/grid and `box-shadow`, so the fallback must already look
 * right. The document icon is drawn with nested tables (no extra image to host);
 * the logo is the public BW Furniture PNG on the production site.
 */

import { escapeHtml } from "./email.ts";

export interface QuoteViewEmailInput {
  /** Quotation number shown in the subject and detail table. */
  quoteId: string;
  /** Raw `viewed_at` timestamp from `bwf_quote_share_view`. */
  viewedAtIso: string;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Brand assets are served from the public production site: preview deployments
 * sit behind Vercel SSO, so a logo URL derived from `FDS_APP_URL` would 302 in
 * test emails.
 */
const LOGO_URL = "https://www.bwteam-furniture.com/assets/bwf-logo.png";

const FONT_STACK =
  "'Noto Sans HK','PingFang HK','Microsoft JhengHei',system-ui,-apple-system,'Segoe UI',sans-serif";

const COMPANY = {
  name: "BW Furniture",
  tagline: "Professional Furniture Solutions for a Better Space",
  addressLines: [
    "Room D-G, 5/F, Wah Lik Industrial Centre,",
    "459-469 Castle Peak Road,",
    "Tsuen Wan, Hong Kong",
  ],
  phone: "(+852) 2127 4839",
  whatsapp: "(+852) 9717 3545",
  email: "sales@brandingworks-furniture.com",
} as const;

/** Quote notifications are always shown in Hong Kong time, matching the PM's day. */
export function formatHongKongTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")} (GMT+8)`;
}

/** Quote ids are hyphen-separated; `<wbr>` lets the mobile layout break on a hyphen. */
function breakableQuoteId(value: string): string {
  return escapeHtml(value).replace(/-/g, "-<wbr>");
}

function detailRow(label: string, value: string, breakable = false): string {
  const valueHtml = breakable ? breakableQuoteId(value) : escapeHtml(value);
  const valueWrap = breakable
    ? "word-break:normal;overflow-wrap:anywhere;"
    : "word-break:normal;overflow-wrap:break-word;";
  return `<tr>
    <td class="email-detail-label" width="112" valign="top" style="width:112px;padding:7px 16px 7px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:#64748B;">${escapeHtml(label)}</td>
    <td valign="top" style="padding:7px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:#0F1B3D;font-weight:600;${valueWrap}">${valueHtml}</td>
  </tr>`;
}

function iconHtml(): string {
  const bar = (width: number) =>
    `<div style="width:${width}px;height:5px;background-color:#FFFFFF;border-radius:2.5px;font-size:0;line-height:0;">&nbsp;</div>`;
  return `<table role="presentation" width="72" height="72" cellpadding="0" cellspacing="0" border="0" style="width:72px;height:72px;background-color:#E7EFFF;border-radius:36px;">
    <tr>
      <td align="center" valign="middle" style="text-align:center;vertical-align:middle;">
        <table role="presentation" align="center" width="38" height="52" cellpadding="0" cellspacing="0" border="0" style="width:38px;height:52px;margin:0 auto;background-color:#2F6BED;border-radius:7px;">
          <tr><td style="height:12px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:0 0 0 7px;">${bar(15)}</td></tr>
          <tr><td style="height:7px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:0 0 0 7px;">${bar(23)}</td></tr>
          <tr><td style="height:7px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr><td style="padding:0 0 0 7px;">${bar(15)}</td></tr>
          <tr><td style="height:11px;font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function footerHtml(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
    <tr>
      <td valign="top" style="padding:0 8px;font-family:${FONT_STACK};">
        <div style="font-size:14px;line-height:1.5;font-weight:700;color:#0E1B3A;">
          ${COMPANY.name}
          <span class="email-footer-sep" style="color:#C7D0DF;font-weight:400;">&nbsp;|&nbsp;</span>
          <span class="email-footer-tagline" style="font-size:12.5px;font-weight:400;color:#75839A;">${COMPANY.tagline}</span>
        </div>
        <div style="font-size:12.5px;line-height:1.85;color:#7B889D;padding-top:10px;">
          ${COMPANY.addressLines.map((line) => escapeHtml(line)).join("<br>")}<br>
          <span style="display:inline-block;padding-top:8px;">
            電話：${escapeHtml(COMPANY.phone)}<br>
            手機 WhatsApp: ${escapeHtml(COMPANY.whatsapp)}
          </span><br>
          <div style="padding-top:8px;"><a href="mailto:${escapeHtml(COMPANY.email)}" style="color:#2F6BED;text-decoration:none;">${escapeHtml(COMPANY.email)}</a></div>
        </div>
      </td>
    </tr>
  </table>`;
}

export function buildQuoteViewEmail(input: QuoteViewEmailInput): BuiltEmail {
  const quoteId = String(input.quoteId ?? "").trim() || "未命名報價";
  const viewedAt = formatHongKongTime(String(input.viewedAtIso ?? ""));
  const subject = `客戶已查看報價：${quoteId}`;
  const subheading = "您的報價單已被客戶開啟，系統已自動停用該報價的進度提醒。";

  const text = [
    subheading,
    "",
    `報價單 ${quoteId} 已於以下時間被客戶查看，`,
    "我們已自動停止針對該報價的後續進度提醒，其他報價單的提醒設定不受影響。",
    "",
    `報價編號：${quoteId}`,
    `查看時間：${viewedAt}`,
    "查看方式：客戶開啟報價頁面",
    "",
    "此為系統自動發送的通知郵件，請勿回覆。",
    "如有任何疑問，請聯絡項目負責人或系統管理員。",
    "",
    COMPANY.name,
    COMPANY.tagline,
    COMPANY.addressLines.join("\n"),
    `電話：${COMPANY.phone}`,
    `手機 WhatsApp: ${COMPANY.whatsapp}`,
    COMPANY.email,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>客戶已查看報價</title>
<style>
  @media only screen and (max-width:620px) {
    .email-shell { padding:20px 12px 28px !important; }
    .email-card-pad { padding:30px 22px 0 !important; }
    .email-hero-icon { display:none !important; }
    .email-title { font-size:22px !important; }
    .email-header-right { display:none !important; }
    .email-detail-label { width:88px !important; }
    .email-footer-sep { display:none !important; }
    .email-footer-tagline { display:block !important; padding-top:4px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#F1F5FC;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:#F1F5FC;">${escapeHtml(subheading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#F1F5FC;">
  <tr>
    <td class="email-shell" align="center" style="padding:32px 16px 40px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;table-layout:fixed;">
        <tr>
          <td style="padding:0 6px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              <tr>
                <td align="left" valign="middle">
                  <img src="${escapeHtml(LOGO_URL)}" width="156" height="41" alt="BW Furniture" style="display:block;width:156px;height:auto;max-width:156px;border:0;outline:none;text-decoration:none;">
                </td>
                <td class="email-header-right" align="right" valign="middle" style="padding-left:20px;font-family:${FONT_STACK};font-size:12.5px;line-height:1.5;color:#5F6B80;white-space:nowrap;">
                  Quotation Management System
                  <span style="color:#C7D0DF;">&nbsp;|&nbsp;</span>
                  Design · Quote · Deliver
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;background-color:#FFFFFF;border:1px solid #E5EAF3;border-radius:18px;border-collapse:separate;box-shadow:0 18px 48px rgba(20,40,80,0.08);">
              <tr>
                <td class="email-card-pad" style="padding:44px 48px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
                    <tr>
                      <td class="email-hero-icon" width="72" valign="middle" style="width:72px;padding:0 24px 0 0;">${iconHtml()}</td>
                      <td valign="middle">
                        <div class="email-title" style="font-family:${FONT_STACK};font-size:28px;line-height:1.35;font-weight:700;color:#0E1B3A;letter-spacing:-0.02em;">客戶已查看報價</div>
                        <div style="font-family:${FONT_STACK};font-size:16px;line-height:1.7;color:#5B6880;padding-top:10px;">${escapeHtml(subheading)}</div>
                      </td>
                    </tr>
                  </table>

                  <div style="height:1px;background-color:#E9EDF5;font-size:0;line-height:0;margin-top:32px;">&nbsp;</div>

                  <div style="font-family:${FONT_STACK};font-size:16px;line-height:1.95;color:#1D2939;padding-top:26px;">
                    報價單 <span style="color:#0E1B3A;font-weight:600;word-break:normal;overflow-wrap:anywhere;">${breakableQuoteId(quoteId)}</span> 已於以下時間被客戶查看，<br>
                    我們已自動停止針對該報價的後續進度提醒，其他報價單的提醒設定不受影響。
                  </div>

                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#F5F9FF;border:1px solid #E6EEFB;border-radius:14px;border-collapse:separate;margin-top:28px;">
                    <tr>
                      <td style="padding:22px 28px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">
                          ${detailRow("報價編號", quoteId, true)}
                          ${detailRow("查看時間", viewedAt)}
                          ${detailRow("查看方式", "客戶開啟報價頁面")}
                        </table>
                      </td>
                    </tr>
                  </table>

                  <div style="height:1px;background-color:#E9EDF5;font-size:0;line-height:0;margin-top:28px;">&nbsp;</div>

                  <div style="font-family:${FONT_STACK};font-size:13px;line-height:1.95;color:#7C8AA3;padding-top:20px;">
                    此為系統自動發送的通知郵件，請勿回覆。<br>
                    如有任何疑問，請聯絡項目負責人或系統管理員。
                  </div>
                </td>
              </tr>
              <tr><td style="height:44px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 0 0;">${footerHtml()}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
