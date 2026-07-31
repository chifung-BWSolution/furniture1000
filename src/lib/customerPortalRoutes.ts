import type { ViewType } from '@/types/product';

/** Client portal base path — invite links and in-portal nav live under here. */
export const CUSTOMER_PORTAL_BASE = '/customer';

export const CUSTOMER_PORTAL_TOKEN_KEY = 'fds-client-portal-token';

const CUSTOMER_VIEW_SLUGS: { view: ViewType; slug: string }[] = [
  { view: 'customer-quote-schemes', slug: 'quote-schemes' },
  { view: 'customer-product-search', slug: 'product-search' },
  { view: 'customer-custom-furniture', slug: 'custom-furniture' },
  { view: 'customer-payment-delivery', slug: 'payment-delivery' },
  { view: 'customer-order-status', slug: 'order-status' },
  { view: 'customer-case-studies', slug: 'case-studies' },
  { view: 'customer-services', slug: 'services' },
  { view: 'customer-company-info', slug: 'company-info' },
  { view: 'customer-contact', slug: 'contact' },
  { view: 'customer-org-account', slug: 'org-account' },
];

const VIEW_BY_SLUG = new Map(
  CUSTOMER_VIEW_SLUGS.map((row) => [row.slug, row.view] as const),
);
const SLUG_BY_VIEW = new Map(
  CUSTOMER_VIEW_SLUGS.map((row) => [row.view, row.slug] as const),
);

export function isCustomerPortalView(view: ViewType): boolean {
  return SLUG_BY_VIEW.has(view) ||
    view === 'customer-design-projects' ||
    view === 'customer-confirmed-products';
}

export function isCustomerPortalPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === CUSTOMER_PORTAL_BASE || path.startsWith(`${CUSTOMER_PORTAL_BASE}/`);
}

export function customerViewFromPath(pathname: string): ViewType | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === CUSTOMER_PORTAL_BASE) return 'customer-quote-schemes';
  if (!path.startsWith(`${CUSTOMER_PORTAL_BASE}/`)) return null;
  const slug = path.slice(CUSTOMER_PORTAL_BASE.length + 1).split('/')[0] || '';
  if (!slug) return 'customer-quote-schemes';
  return VIEW_BY_SLUG.get(slug) || 'customer-quote-schemes';
}

export function pathFromCustomerView(view: ViewType): string {
  const slug = SLUG_BY_VIEW.get(view);
  if (!slug || view === 'customer-quote-schemes') return CUSTOMER_PORTAL_BASE;
  return `${CUSTOMER_PORTAL_BASE}/${slug}`;
}

/** Invite / share link for 客戶專區. */
export function buildCustomerPortalInviteUrl(
  origin: string,
  token: string,
): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${CUSTOMER_PORTAL_BASE}?portal_token=${encodeURIComponent(token)}`;
}

/** Quote-only share link → 客戶專區「報價方案」detail for that quote. */
export function buildCustomerPortalQuoteShareUrl(
  origin: string,
  token: string,
): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${CUSTOMER_PORTAL_BASE}?quote_share=${encodeURIComponent(token)}`;
}

export const CUSTOMER_QUOTE_SHARE_TOKEN_KEY = 'fds-client-quote-share-token';

export function readStoredQuoteShareToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CUSTOMER_QUOTE_SHARE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeQuoteShareToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOMER_QUOTE_SHARE_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearQuoteShareToken() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CUSTOMER_QUOTE_SHARE_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** True when URL or storage has a quote-share token (guest portal access). */
export function hasActiveQuoteShareAccess(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const fromUrl = new URLSearchParams(window.location.search)
      .get('quote_share')
      ?.trim();
    if (fromUrl) return true;
    return Boolean(readStoredQuoteShareToken()?.trim());
  } catch {
    return false;
  }
}

/** Append portal invite + quote-share query params for customer deep links. */
export function withCustomerPortalQuery(
  path: string,
  opts?: { portalToken?: string | null; quoteShareToken?: string | null },
): string {
  const params = new URLSearchParams();
  const portal = opts?.portalToken?.trim();
  const quoteShare = opts?.quoteShareToken?.trim();
  if (portal) params.set('portal_token', portal);
  if (quoteShare) params.set('quote_share', quoteShare);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function readStoredPortalToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CUSTOMER_PORTAL_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storePortalToken(token: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CUSTOMER_PORTAL_TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearPortalToken() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CUSTOMER_PORTAL_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
