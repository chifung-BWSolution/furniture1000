/**
 * Browser-side twin of supabase/functions/_shared/pmsProject.ts.
 * Keep the project refs and default rule in sync with that file.
 */

export const FURNITURE_PRODUCTION_REF = 'riaubhtruisbwdlwjzur';
export const PMS_PRODUCTION_REF = 'kqwktnplkqucsbasyfjl';
export const PMS_DEV_REF = 'alrbbyqkeobmvvvscpma';

export const PMS_PRODUCTION_URL = `https://${PMS_PRODUCTION_REF}.supabase.co`;
export const PMS_DEV_URL = `https://${PMS_DEV_REF}.supabase.co`;

function explicitHttps(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/\/$/, '');
  return trimmed.startsWith('https://') ? trimmed : '';
}

export function resolvePmsProjectUrl(furnitureUrl: string, explicitUrl?: string): string {
  const override = explicitHttps(explicitUrl);
  if (override) return override;
  if ((furnitureUrl ?? '').includes(FURNITURE_PRODUCTION_REF)) return PMS_PRODUCTION_URL;
  return PMS_DEV_URL;
}

export function projectRefFromUrl(url: string): string | null {
  const match = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
  return match?.[1] ?? null;
}

export function jwtProjectRef(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded));
    return typeof payload.ref === 'string' ? payload.ref : null;
  } catch {
    return null;
  }
}
