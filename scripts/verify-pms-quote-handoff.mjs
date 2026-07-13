/**
 * Lightweight checks for PMS quote prefill + SSO redirect helpers.
 * Run: node scripts/verify-pms-quote-handoff.mjs
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

function asUuid(raw) {
  const v = (raw || '').trim();
  return v && UUID_RE.test(v) ? v : undefined;
}

function parsePrefill(qs) {
  const params = new URLSearchParams(qs);
  const out = {};
  const pitchingId = asUuid(params.get('pmsPitchingId'));
  if (pitchingId) out.pmsPitchingId = pitchingId;
  const projectId = asUuid(params.get('pmsProjectId'));
  if (projectId) out.pmsProjectId = projectId;
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

const pitchingId = '7682ee11-e1cb-4c78-a2b0-1833352d8a65';
const projectId = '689920a2-bc67-48b5-8f06-84eb25e2dc81';

const prefill = parsePrefill(
  `pmsPitchingId=${pitchingId}&projectName=BWF-SH26-049&projectManager=Winnie&clientName=Simon&clientIndustry=教育&quotationType=${encodeURIComponent('傢俬採購')}`,
);
assert(prefill.pmsPitchingId === pitchingId, 'pitching id');
assert(!prefill.pmsProjectId, 'no project id when only pitching passed');
assert(prefill.projectName === 'BWF-SH26-049', 'project name');
assert(prefill.clientIndustry?.[0] === '教育', 'industry chip');
assert(prefill.quotationType?.[0] === '傢俬採購', 'quotation type');
assert(prefill.company === 'Branding Works Design Ltd', 'default company');

// PMS Quote tab uses pmsProjectId (= bwf_projects.id), not a pitching alias
const prefillProject = parsePrefill(
  `pmsProjectId=${projectId}&projectName=BWF-FD26-001&projectManager=Leo+Tse&clientName=Test+Pitching`,
);
assert(prefillProject.pmsProjectId === projectId, 'pmsProjectId kept as project id');
assert(!prefillProject.pmsPitchingId, 'pmsProjectId must NOT be aliased to pitching');
assert(prefillProject.projectName === 'BWF-FD26-001', 'project name from project handoff');

// Both can be present
const both = parsePrefill(`pmsPitchingId=${pitchingId}&pmsProjectId=${projectId}`);
assert(both.pmsPitchingId === pitchingId && both.pmsProjectId === projectId, 'both ids');

const path =
  '/quote/quick?pmsPitchingId=' +
  pitchingId +
  '&projectName=BWF-SH26-049&quotationType=' +
  encodeURIComponent('傢俬採購');
assert(
  sanitizePostLoginRedirect(encodeURIComponent(path)) === path,
  'encoded redirect preserved',
);
assert(sanitizePostLoginRedirect(path) === path, 'plain path ok');
assert(sanitizePostLoginRedirect('https://evil.com/x') === null, 'reject absolute');
assert(sanitizePostLoginRedirect('//evil.com') === null, 'reject protocol-relative');

const nested = new URLSearchParams(
  `redirect_to=${encodeURIComponent(path)}&code=abc`,
);
assert(sanitizePostLoginRedirect(nested.get('redirect_to')) === path, 'nested redirect_to');

console.log('verify-pms-quote-handoff: ok');
