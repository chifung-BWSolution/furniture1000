/**
 * Shared outbound email for FDS edge functions.
 *
 * Same providers as the existing upload-log report: Resend when `RESEND_API_KEY`
 * is set, otherwise Gmail SMTP (`GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD`).
 * The sender identity always comes from the environment, never from the browser.
 */

export interface OutboundEmail {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  provider: 'resend' | 'gmail_smtp';
  id: string | null;
}

/** Sender shown to the recipient. `FDS_EMAIL_FROM` wins; otherwise the FDS no-reply box. */
export function emailFromAddress(): string {
  return Deno.env.get("FDS_EMAIL_FROM")?.trim()
    || "FDS Furniture <no-reply@bwteam-furniture.com>";
}

/** Reply-To / human contact line; never invented, only read from the environment. */
export function emailReplyTo(): string | null {
  const value = Deno.env.get("FDS_EMAIL_REPLY_TO")?.trim()
    || Deno.env.get("GMAIL_SMTP_USER")?.trim()
    || Deno.env.get("SMTP_USER")?.trim()
    || "";
  return isSafeEmail(value) ? value : null;
}

export function isSafeEmail(value: string): boolean {
  if (!value || value.length > 320) return false;
  if (/[\r\n\0]/.test(value)) return false;
  return /^[^\s<>"]+@[^\s<>"]+\.[^\s<>"]+$/.test(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

async function sendViaGmailSmtp(email: OutboundEmail): Promise<SendResult> {
  const user = Deno.env.get("GMAIL_SMTP_USER") ?? Deno.env.get("SMTP_USER") ?? "";
  const pass = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? Deno.env.get("SMTP_PASS") ?? "";
  if (!user || !pass) throw new Error("Gmail SMTP not configured");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const conn = await Deno.connectTls({ hostname: "smtp.gmail.com", port: 465 });

  const readResponse = async (): Promise<string> => {
    const buf = new Uint8Array(4096);
    const n = await conn.read(buf);
    return n === null ? "" : decoder.decode(buf.subarray(0, n));
  };
  const sendLine = async (line: string): Promise<string> => {
    await conn.write(encoder.encode(`${line}\r\n`));
    return readResponse();
  };

  await readResponse();
  await sendLine("EHLO fds-edge");
  await sendLine("AUTH LOGIN");
  await sendLine(toBase64(user));
  const authResp = await sendLine(toBase64(pass));
  if (!authResp.startsWith("235")) {
    conn.close();
    throw new Error(`SMTP auth failed: ${authResp.trim()}`);
  }

  await sendLine(`MAIL FROM:<${user}>`);
  for (const recipient of email.to) {
    const rcptResp = await sendLine(`RCPT TO:<${recipient}>`);
    if (!rcptResp.startsWith("250")) {
      conn.close();
      throw new Error(`SMTP RCPT failed for ${recipient}: ${rcptResp.trim()}`);
    }
  }
  await sendLine("DATA");
  const boundary = `----=_Part_${Date.now()}`;
  const body = [
    `From: ${emailFromAddress()}`,
    `To: ${email.to.join(", ")}`,
    `Subject: =?UTF-8?B?${toBase64(email.subject)}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(email.text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    toBase64(email.html),
    "",
    `--${boundary}--`,
    ".",
  ].join("\r\n");
  const dataResp = await sendLine(body);
  await sendLine("QUIT");
  conn.close();
  if (!dataResp.startsWith("250")) {
    throw new Error(`SMTP DATA failed: ${dataResp.trim()}`);
  }
  return { provider: "gmail_smtp", id: `smtp-${Date.now()}` };
}

async function sendViaResend(email: OutboundEmail): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const payload: Record<string, unknown> = {
    from: emailFromAddress(),
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  };
  const replyTo = emailReplyTo();
  if (replyTo) payload.reply_to = replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body === "object" && body && "message" in body
      ? String((body as { message?: unknown }).message)
      : JSON.stringify(body);
    throw new Error(`Resend API failed (${res.status}): ${message}`);
  }
  const id = typeof body === "object" && body && "id" in body ? String((body as { id?: unknown }).id) : null;
  return { provider: "resend", id };
}

/** Send one email. Throws when no provider is configured or both providers fail. */
export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  if (email.to.length === 0) throw new Error("no recipient");
  for (const recipient of email.to) {
    if (!isSafeEmail(recipient)) throw new Error("invalid recipient");
  }
  const hasResend = Boolean(Deno.env.get("RESEND_API_KEY"));
  const hasSmtp = Boolean(
    (Deno.env.get("GMAIL_SMTP_USER") ?? Deno.env.get("SMTP_USER"))
      && (Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? Deno.env.get("SMTP_PASS")),
  );
  if (!hasResend && !hasSmtp) {
    throw new Error("Email not configured. Set RESEND_API_KEY or GMAIL_SMTP_USER + GMAIL_SMTP_APP_PASSWORD.");
  }
  let resendError: unknown = null;
  if (hasResend) {
    try {
      return await sendViaResend(email);
    } catch (error) {
      resendError = error;
      if (!hasSmtp) throw error;
    }
  }
  try {
    return await sendViaGmailSmtp(email);
  } catch (error) {
    if (resendError) {
      console.error("[email] Resend failed:", resendError instanceof Error ? resendError.message : resendError);
    }
    throw error;
  }
}
