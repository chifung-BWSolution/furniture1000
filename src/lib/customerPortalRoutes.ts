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

/**
 * No-login customer portal share link.
 * Lands on「報價方案」for the shared quote — that page is the whole guest
 * experience. Switching to any other 客戶專區 page asks the visitor to sign in
 * (see AppShell `requireQuoteShareLogin`), so the quote cannot be used as a
 * free pass into the rest of the portal.
 */
export function buildCustomerPortalQuoteShareUrl(
  origin: string,
  token: string,
): string {
  const base = origin.replace(/\/+$/, '');
  return `${base}${CUSTOMER_PORTAL_BASE}?quote_share=${encodeURIComponent(token)}`;
}

export const CUSTOMER_QUOTE_SHARE_TOKEN_KEY = 'fds-client-quote-share-token';
export const CUSTOMER_QUOTE_SHARE_TARGET_KEY = 'fds-client-quote-share-target';

/**
 * Router state for「分享連結只開放報價方案，登入後才可以看其他頁」.
 * Set by AppShell when it sends a quote-share guest to sign in; read by
 * RequireAuth so the login card explains why the visitor landed there.
 */
export type QuoteShareLoginState = {
  quoteShareLogin?: boolean;
  /**
   * 分享報價頁（含 token）。登入畫面用它在下方提供「返回報價方案」，
   * 避免只想看報價的訪客卡在登入頁。
   */
  quoteShareReturnTo?: string;
};

/**
 * Persist `?quote_share=` as early as possible (module load), before React
 * URL-sync effects can strip the query string (e.g. bounce to `/` or `/quote/…`).
 */
function captureQuoteShareTokenFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const token = new URLSearchParams(window.location.search)
      .get('quote_share')
      ?.trim();
    if (token) {
      localStorage.setItem(CUSTOMER_QUOTE_SHARE_TOKEN_KEY, token);
    }
  } catch {
    /* ignore */
  }
}
captureQuoteShareTokenFromUrl();

/**
 * Opening the staff site (e.g. https://www.bwteam-furniture.com/) must not keep
 * a previous quote-share preview. The token stays only for /customer and for
 * URLs that still carry ?quote_share=.
 */
function releaseQuoteShareLockOutsidePortal(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('quote_share')?.trim()) return;
    if (isCustomerPortalPath(window.location.pathname)) return;
    localStorage.removeItem(CUSTOMER_QUOTE_SHARE_TOKEN_KEY);
    localStorage.removeItem(CUSTOMER_QUOTE_SHARE_TARGET_KEY);
  } catch {
    /* ignore */
  }
}
releaseQuoteShareLockOutsidePortal();

export function readStoredQuoteShareToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    captureQuoteShareTokenFromUrl();
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
    localStorage.removeItem(CUSTOMER_QUOTE_SHARE_TARGET_KEY);
  } catch {
    /* ignore */
  }
}

export function storeQuoteShareTarget(target: {
  quoteUuid: string;
  quoteId: string;
}) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      CUSTOMER_QUOTE_SHARE_TARGET_KEY,
      JSON.stringify({
        quoteUuid: target.quoteUuid,
        quoteId: target.quoteId,
      }),
    );
  } catch {
    /* ignore */
  }
}

export function readStoredQuoteShareTarget(): {
  quoteUuid: string;
  quoteId: string;
} | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CUSTOMER_QUOTE_SHARE_TARGET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      quoteUuid?: string;
      quoteId?: string;
    };
    const quoteUuid = String(parsed.quoteUuid || '').trim();
    const quoteId = String(parsed.quoteId || '').trim();
    if (!quoteUuid) return null;
    return { quoteUuid, quoteId };
  } catch {
    return null;
  }
}

/**
 * Quote-share guest mode follows the link the user opened.
 * `?quote_share=` always counts. A token left in storage only keeps the
 * session alive on /customer (refresh and in-portal pages). It must not
 * pull https://www.bwteam-furniture.com/ back into 客戶專區.
 */
export function quoteShareSessionApplies(
  pathname: string,
  search: string,
  storedToken: string | null | undefined,
): boolean {
  const fromUrl = new URLSearchParams(search).get('quote_share')?.trim();
  if (fromUrl) return true;
  if (!isCustomerPortalPath(pathname)) return false;
  return Boolean(storedToken?.trim());
}

/** True when this page load should enter 客戶專區 without staff login. */
export function hasActiveQuoteShareAccess(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return quoteShareSessionApplies(
      window.location.pathname,
      window.location.search,
      readStoredQuoteShareToken(),
    );
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
