import { sanitizePostLoginRedirect } from '@/lib/pmsQuotePrefill';

/**
 * Resolve the post-SSO destination from callback query params.
 * Prefers `redirect_to`, then `next`. Always returns a safe relative path
 * (or null → caller should fall back to `/`).
 */
export function resolveSsoPostLoginPath(searchParams: URLSearchParams): string | null {
  const candidates = [
    searchParams.get('redirect_to'),
    searchParams.get('next'),
  ];

  for (const candidate of candidates) {
    const safe = sanitizePostLoginRedirect(candidate);
    if (safe) return safe;
  }

  return null;
}
