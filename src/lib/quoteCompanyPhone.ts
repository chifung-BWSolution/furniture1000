/**
 * 快速報價「公司資訊 > 電話」— 依登入電郵或用戶名稱套用專員聯絡電話。
 */

export type QuoteCompanyPhoneUser = {
  name: string;
  email: string;
  phone: string;
};

export const QUOTE_COMPANY_PHONE_USERS: readonly QuoteCompanyPhoneUser[] = [
  {
    name: 'Luca Shen',
    email: 'cfb.f02@chifung.net',
    phone: '5163 4272 / 9717 3545',
  },
  {
    name: 'Mark Jiao',
    email: 'cfb.f01@chifung.net',
    phone: '5163 4839 / 9717 3545',
  },
  {
    name: 'Rachel Zhu',
    email: 'cfb.f03@chifung.net',
    phone: '6263 4365 / 9717 3545',
  },
  {
    name: 'Winnie Zhu',
    email: 'cfb.f04@chifung.net',
    phone: '5163 7535 / 9717 3545',
  },
  {
    name: 'Michael Lee',
    email: 'cfb.f05@chifung.net',
    phone: '6858 6023 / 9717 3545',
  },
] as const;

/** Previous hardcoded draft default (Mark, unspaced). */
export const LEGACY_QUOTE_COMPANY_PHONE = '51634839/ 97173545';

/** Fallback when the current user is not in the mapped list. */
export const DEFAULT_QUOTE_COMPANY_PHONE = '5163 4839 / 9717 3545';

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function nameMatches(candidate: string, mappedName: string): boolean {
  const name = normalizeKey(candidate);
  const full = normalizeKey(mappedName);
  if (!name || !full) return false;
  if (name === full) return true;
  const first = full.split(' ')[0] || '';
  if (first && name === first) return true;
  if (name.startsWith(`${full} `)) return true;
  if (name.includes(full)) return true;
  return false;
}

/** Resolve company phone for the logged-in user; null when no mapping matches. */
export function resolveQuoteCompanyPhone(opts: {
  email?: string | null;
  name?: string | null;
}): string | null {
  const email = opts.email?.trim().toLowerCase() || '';
  if (email) {
    const byEmail = QUOTE_COMPANY_PHONE_USERS.find(
      (row) => row.email.toLowerCase() === email,
    );
    if (byEmail) return byEmail.phone;
  }

  const name = opts.name?.trim() || '';
  if (name) {
    const byName = QUOTE_COMPANY_PHONE_USERS.find((row) =>
      nameMatches(name, row.name),
    );
    if (byName) return byName.phone;
  }

  return null;
}

export function defaultQuoteCompanyPhone(opts: {
  email?: string | null;
  name?: string | null;
}): string {
  return resolveQuoteCompanyPhone(opts) || DEFAULT_QUOTE_COMPANY_PHONE;
}
