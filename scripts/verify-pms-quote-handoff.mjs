/**
 * Lightweight checks for PMS quote prefill + SSO redirect helpers.
 * Run: node --experimental-strip-types scripts/verify-pms-quote-handoff.mjs
 * (or import via vite/tsx). Pure JS reimplementation to avoid TS build deps.
 */

const INDUSTRIES = ['餐飲', '辦公', '零售', '醫療', '教育', '酒店', '住宅', '其他'];
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sanitizePostLoginRedirect(raw) {
  if (!raw) return null;
  let value = String(raw).trim();
  if (!value) return null;
  if (/^%2f/i.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch {
      /* keep */
    }
  }
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (value.includes('://')) return null;
  return value;
}

function parsePrefill(qs) {
  const params = new URLSearchParams(qs);
  const pitchingId =
    (params.get('pmsPitchingId') || '').trim() ||
    (params.get('pmsProjectId') || '').trim();
  const out = {};
  if (pitchingId && UUID_RE.test(pitchingId)) out.pmsPitchingId = pitchingId;
  for (const k of ['projectName', 'projectManager', 'clientName', 'clientPhone', 'clientEmail', 'company']) {
    const v = (params.get(k) || '').trim();
    if (v) out[k] = v;
  }
  const industry = (params.get('clientIndustry') || '').trim();
  if (industry) {
    const chips = industry.split(/[,|]/).map((s) => s.trim()).filter((v) => INDUSTRIES.includes(v));
    if (chips.length) out.clientIndustry = chips;
  }
  const qt = (params.get('quotationType') || '').trim();
  if (qt) out.quotationType = qt.split(/[,|]/).map((s) => s.trim()).filter(Boolean);
  if (!out.company) out.company = 'Branding Works Design Ltd';
  return out;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const id = '7682ee11-e1cb-4c78-a2b0-1833352d8a65';
const prefill = parsePrefill(
  `pmsPitchingId=${id}&projectName=BWF-SH26-049&projectManager=Winnie&clientName=Simon&clientIndustry=教育&quotationType=${encodeURIComponent('傢俬採購')}`,
);
assert(prefill.pmsPitchingId === id, 'pitching id');
assert(prefill.projectName === 'BWF-SH26-049', 'project name');
assert(prefill.clientIndustry?.[0] === '教育', 'industry chip');
assert(prefill.quotationType?.[0] === '傢俬採購', 'quotation type');
assert(prefill.company === 'Branding Works Design Ltd', 'default company');

// PMS Quote tab uses pmsProjectId (same UUID as bwf_pitchings.id)
const prefillAlias = parsePrefill(
  `pmsProjectId=${id}&projectName=BWF-FD26-001&projectManager=Leo+Tse&clientName=Test+Pitching`,
);
assert(prefillAlias.pmsPitchingId === id, 'pmsProjectId alias → pmsPitchingId');
assert(prefillAlias.projectName === 'BWF-FD26-001', 'alias project name');

const path =
  '/quote/quick?pmsPitchingId=' +
  id +
  '&projectName=BWF-SH26-049&quotationType=' +
  encodeURIComponent('傢俬採購');
assert(
  sanitizePostLoginRedirect(encodeURIComponent(path)) === path,
  'encoded redirect preserved',
);
assert(sanitizePostLoginRedirect(path) === path, 'plain path ok');
assert(sanitizePostLoginRedirect('https://evil.com/x') === null, 'reject absolute');
assert(sanitizePostLoginRedirect('//evil.com') === null, 'reject protocol-relative');

// Mint-style nesting: callback?redirect_to=<path>&code=...
const nested = new URLSearchParams(
  `redirect_to=${encodeURIComponent(path)}&code=abc`,
);
assert(sanitizePostLoginRedirect(nested.get('redirect_to')) === path, 'nested redirect_to');

console.log('verify-pms-quote-handoff: ok');
