/** Shared admin / service accounts: show email so reports are searchable by login. */
const EMAIL_ALIASES: Record<string, string> = {
  'chifung.login@gmail.com': 'Branding Works',
};

/**
 * Display label for upload_log / login reports.
 * Keeps PMS staff name but appends login email for shared admin accounts.
 */
export function formatUploadLogUserLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const n = name?.trim();
  const e = email?.trim().toLowerCase();
  if (!n && !e) return '（無用戶紀錄）';
  if (!n) return e!;
  if (!e) return n;
  if (n.toLowerCase() === e || n.includes(e)) return n;
  const alias = EMAIL_ALIASES[e];
  if (alias && n === alias) return `${n} (${e})`;
  if (looksLikeEmail(n)) return e;
  return n;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
