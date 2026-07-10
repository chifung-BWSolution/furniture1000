/** PMS → 快速報價 Step 1 query-param prefill helpers. */

export const PMS_QUOTE_INDUSTRIES = [
  '餐飲',
  '辦公',
  '零售',
  '醫療',
  '教育',
  '酒店',
  '住宅',
  '其他',
] as const;

export const DEFAULT_QUOTE_COMPANY = 'Branding Works Design Ltd';

export interface PmsQuotePrefill {
  pmsPitchingId?: string;
  projectName?: string;
  projectManager?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientIndustry?: string[];
  quotationType?: string[];
  company?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function firstParam(params: URLSearchParams, key: string): string {
  return (params.get(key) || '').trim();
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * PMS may send either `pmsPitchingId` (Furniture convention) or
 * `pmsProjectId` (bwteam-project.com Quote-tab handoff). Both are the
 * PMS `bwf_pitchings.id` UUID.
 */
function resolvePitchingIdFromParams(params: URLSearchParams): string {
  return (
    firstParam(params, 'pmsPitchingId') ||
    firstParam(params, 'pmsProjectId') ||
    ''
  );
}

/** True when the URL carries at least one PMS prefill signal. */
export function hasPmsQuotePrefillParams(params: URLSearchParams): boolean {
  return Boolean(
    resolvePitchingIdFromParams(params) ||
      firstParam(params, 'projectName') ||
      firstParam(params, 'projectManager') ||
      firstParam(params, 'clientName'),
  );
}

export function parsePmsQuotePrefill(params: URLSearchParams): PmsQuotePrefill | null {
  if (!hasPmsQuotePrefillParams(params)) return null;

  const prefill: PmsQuotePrefill = {};

  const pitchingId = resolvePitchingIdFromParams(params);
  if (pitchingId && UUID_RE.test(pitchingId)) {
    prefill.pmsPitchingId = pitchingId;
  }

  const projectName = firstParam(params, 'projectName');
  if (projectName) prefill.projectName = projectName;

  const projectManager = firstParam(params, 'projectManager');
  if (projectManager) prefill.projectManager = projectManager;

  const clientName = firstParam(params, 'clientName');
  if (clientName) prefill.clientName = clientName;

  const clientPhone = firstParam(params, 'clientPhone');
  if (clientPhone) prefill.clientPhone = clientPhone;

  const clientEmail = firstParam(params, 'clientEmail');
  if (clientEmail) prefill.clientEmail = clientEmail;

  const industryRaw = firstParam(params, 'clientIndustry');
  if (industryRaw) {
    const allowed = new Set<string>(PMS_QUOTE_INDUSTRIES);
    const chips = splitList(industryRaw).filter((v) => allowed.has(v));
    if (chips.length > 0) prefill.clientIndustry = chips;
  }

  const quotationTypeRaw = firstParam(params, 'quotationType');
  if (quotationTypeRaw) {
    prefill.quotationType = splitList(quotationTypeRaw);
  }

  const company = firstParam(params, 'company');
  prefill.company = company || DEFAULT_QUOTE_COMPANY;

  return prefill;
}

/**
 * After PMS SSO, only allow same-origin relative paths (keep query string).
 * Rejects protocol-relative and absolute URLs.
 *
 * URLSearchParams already decodes once; only decode again when the whole
 * value is still percent-encoded (e.g. starts with %2F).
 */
export function sanitizePostLoginRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  if (/^%2f/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw
    }
  }

  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://')) return null;

  return value;
}

export function extractPmsPitchingIdFromProjectData(
  projectData: Record<string, unknown> | null | undefined,
): string | null {
  const formData = projectData?.formData as { pmsPitchingId?: unknown } | undefined;
  const raw = typeof formData?.pmsPitchingId === 'string' ? formData.pmsPitchingId.trim() : '';
  return raw && UUID_RE.test(raw) ? raw : null;
}
