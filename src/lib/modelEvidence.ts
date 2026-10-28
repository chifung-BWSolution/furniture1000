import type { DimensionEstimate } from './dimensionConflicts';
import type { KeyDimension } from './furnitureKeyDimensions';

export type EvidenceStatus = 'confirmed' | 'pending' | 'estimated' | 'missing' | 'conflict';
/** catalog / drawing_label / manual are measured data; ai_photo and model are estimates. */
export type EvidenceSource = 'catalog' | 'drawing_label' | 'ai_photo' | 'model' | 'manual';
export type DimensionScope = 'single' | 'arrangement' | 'unknown';
export type LengthUnit = 'mm' | 'cm' | 'm' | 'in';

export const STATUS_LABEL: Record<EvidenceStatus, string> = {
  confirmed: '已確認',
  pending: '待確認',
  estimated: '估算',
  missing: '缺失',
  conflict: '有衝突',
};

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  catalog: '產品資料',
  drawing_label: '圖紙標註',
  ai_photo: '照片估算',
  model: '零件推算',
  manual: '人工輸入',
};

export interface DimensionCandidate {
  id: string;
  source: EvidenceSource;
  value_mm: number;
  raw_value?: number;
  unit?: LengthUnit;
  /** Text exactly as printed, for labels the AI read off an image. */
  raw_text?: string;
  method?: string;
  location?: string;
  /** 1-based index into the product photos sent for analysis. */
  image_index?: number;
  scope?: DimensionScope;
}

export interface DimensionRecord {
  key: string;
  label: string;
  critical: boolean;
  candidates: DimensionCandidate[];
  selected_id?: string | null;
  reason?: string | null;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  status: EvidenceStatus;
}

export interface ModelEvidence {
  version: 1;
  /** What is being modelled: one item, or the whole set the user explicitly chose. */
  product_scope: 'single' | 'arrangement';
  dimensions: DimensionRecord[];
  /** Constraint contradictions and structure check failures at save time. */
  blockers: string[];
}

/** A size printed on a product image or drawing, as read by the AI. */
export interface LabelledDimension {
  dimension: string;
  value: number;
  unit: LengthUnit;
  raw_text: string;
  image_index?: number | null;
  location?: string | null;
  applies_to?: DimensionScope;
}

export const OVERALL_KEYS = ['width', 'depth', 'height'] as const;
export type OverallKey = (typeof OVERALL_KEYS)[number];
const OVERALL_LABEL: Record<OverallKey, string> = { width: '闊', depth: '深', height: '高' };

const MEASURED: ReadonlySet<EvidenceSource> = new Set(['catalog', 'drawing_label', 'manual']);
const ESTIMATE: ReadonlySet<EvidenceSource> = new Set(['ai_photo', 'model']);
/** Two measured readings further apart than this are different values. */
export const MEASURED_TOLERANCE_MM = 1;
/** An AI estimate further than this share from the measured value contradicts it. */
export const ESTIMATE_TOLERANCE = 0.08;

const round = (n: number) => Math.round(n * 10) / 10;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function toMm(value: number, unit: LengthUnit): number {
  return round(value * { mm: 1, cm: 10, m: 1000, in: 25.4 }[unit]);
}

export const isMeasured = (c: DimensionCandidate) => MEASURED.has(c.source);
export const isEstimate = (c: DimensionCandidate) => ESTIMATE.has(c.source);

/** Whole-set readings never size a single item, and the reverse (AC-08). */
export function usableCandidates(record: DimensionRecord, scope: ModelEvidence['product_scope']): DimensionCandidate[] {
  return record.candidates.filter((c) => (scope === 'single' ? c.scope !== 'arrangement' : c.scope !== 'single'));
}

/** Readable list of the disagreeing values, or null when the sources agree. */
export function conflictOf(record: DimensionRecord, scope: ModelEvidence['product_scope']): string | null {
  const usable = usableCandidates(record, scope);
  const measured = usable.filter(isMeasured);
  const estimates = usable.filter(isEstimate);
  const values = measured.map((c) => c.value_mm);
  const spread = values.length > 1 && Math.max(...values) - Math.min(...values) > MEASURED_TOLERANCE_MM;
  const aiOff = measured.length > 0 && estimates.some((e) =>
    measured.every((m) => Math.abs(e.value_mm - m.value_mm) / m.value_mm > ESTIMATE_TOLERANCE));
  if (!spread && !aiOff) return null;
  return [...measured, ...(aiOff ? estimates : [])]
    .map((c) => `${SOURCE_LABEL[c.source]} ${round(c.value_mm)}`)
    .join(' / ');
}

export function statusOf(record: DimensionRecord, scope: ModelEvidence['product_scope']): EvidenceStatus {
  const usable = usableCandidates(record, scope);
  const selected = usable.find((c) => c.id === record.selected_id);
  const conflict = conflictOf(record, scope) != null;
  // Only estimates and no data: the value is missing until someone supplies it or accepts the estimate.
  if (!selected) return !usable.some(isMeasured) ? 'missing' : conflict ? 'conflict' : 'pending';
  if (conflict && !record.reason?.trim()) return 'conflict';
  if (isEstimate(selected)) return 'estimated';
  return 'confirmed';
}

/** The value the model uses now: the chosen one, else the first measured, else the estimate. */
export function valueOf(record: DimensionRecord, scope: ModelEvidence['product_scope']): number | null {
  const usable = usableCandidates(record, scope);
  const selected = usable.find((c) => c.id === record.selected_id);
  return (selected ?? usable.find(isMeasured) ?? usable.find(isEstimate))?.value_mm ?? null;
}

export function withStatuses(evidence: ModelEvidence): ModelEvidence {
  return {
    ...evidence,
    dimensions: evidence.dimensions.map((d) => ({ ...d, status: statusOf(d, evidence.product_scope) })),
  };
}

export function findDimension(evidence: ModelEvidence | undefined, key: string): DimensionRecord | undefined {
  return evidence?.dimensions.find((d) => d.key === key);
}

/** Why generation cannot start yet. Pending, missing and conflicting critical values block it. */
export function generationBlockers(evidence: ModelEvidence): string[] {
  return evidence.dimensions.flatMap((d) => {
    if (!d.critical) return [];
    if (d.status === 'missing') return [`${d.label}缺少資料，請補值或接受估算`];
    if (d.status === 'conflict') return [`${d.label}來源不一致（${conflictOf(d, evidence.product_scope) ?? '請核對'} mm），請選定採用值並寫理由`];
    if (d.status === 'pending') return [`${d.label}待確認`];
    return [];
  });
}

/** Formal acceptance needs every critical value confirmed from data (estimates do not count). */
export function acceptanceBlockers(evidence: ModelEvidence | undefined): string[] {
  if (!evidence) return ['此版本沒有尺寸證據，只能作未驗收版本使用'];
  return [
    ...evidence.dimensions.filter((d) => d.critical && d.status !== 'confirmed').map((d) => `${d.label}：${STATUS_LABEL[d.status]}`),
    ...evidence.blockers,
  ];
}

export type ModelingState = '待補資料' | '待確認' | '可建模';

export function modelingState(evidence: ModelEvidence): ModelingState {
  const critical = evidence.dimensions.filter((d) => d.critical);
  if (critical.some((d) => d.status === 'missing' || d.status === 'conflict')) return '待補資料';
  if (critical.some((d) => d.status === 'pending')) return '待確認';
  return '可建模';
}

/** Overall axes whose value is not confirmed from data; kept in the parametric model as before. */
export function estimatedOverallAxes(evidence: ModelEvidence): OverallKey[] {
  return OVERALL_KEYS.filter((key) => findDimension(evidence, key)?.status !== 'confirmed');
}

/** Structure values a person fixed from data. Estimates follow the geometry instead of pinning it. */
export function pinnedKeyValues(evidence: ModelEvidence | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of evidence?.dimensions ?? []) {
    if ((OVERALL_KEYS as readonly string[]).includes(d.key)) continue;
    const selected = usableCandidates(d, evidence!.product_scope).find((c) => c.id === d.selected_id);
    if (selected && isMeasured(selected) && d.status === 'confirmed') out[d.key] = selected.value_mm;
  }
  return out;
}

function mapDimensions(evidence: ModelEvidence, key: string, change: (d: DimensionRecord) => DimensionRecord): ModelEvidence {
  return withStatuses({ ...evidence, dimensions: evidence.dimensions.map((d) => (d.key === key ? change(d) : d)) });
}

const stamp = (by: string) => ({ confirmed_by: by, confirmed_at: new Date().toISOString() });

/** Choose one candidate. A reason is required when the sources disagree. */
export function selectCandidate(evidence: ModelEvidence, key: string, candidateId: string, by: string, reason?: string): ModelEvidence {
  return mapDimensions(evidence, key, (d) => ({ ...d, selected_id: candidateId, reason: reason?.trim() || d.reason || null, ...stamp(by) }));
}

export function setReason(evidence: ModelEvidence, key: string, reason: string): ModelEvidence {
  return mapDimensions(evidence, key, (d) => ({ ...d, reason }));
}

/** A typed value replaces the previous manual entry for that dimension. */
export function enterManual(evidence: ModelEvidence, key: string, value_mm: number, by: string, reason?: string): ModelEvidence {
  return mapDimensions(evidence, key, (d) => {
    const id = `manual-${d.key}`;
    const candidates = [...d.candidates.filter((c) => c.id !== id), { id, source: 'manual' as const, value_mm: round(value_mm), unit: 'mm' as const, scope: 'unknown' as const }];
    return { ...d, candidates, selected_id: id, reason: reason?.trim() || d.reason || null, ...stamp(by) };
  });
}

export function clearSelection(evidence: ModelEvidence, key: string): ModelEvidence {
  return mapDimensions(evidence, key, (d) => ({
    ...d,
    selected_id: null,
    reason: null,
    confirmed_by: null,
    confirmed_at: null,
    candidates: d.candidates.filter((c) => c.source !== 'manual'),
  }));
}

/** Accept the estimate for one dimension. The source stays an estimate (never "measured"). */
export function acceptEstimate(evidence: ModelEvidence, key: string, by: string): ModelEvidence {
  const d = findDimension(evidence, key);
  const estimate = d && usableCandidates(d, evidence.product_scope).find(isEstimate);
  return estimate ? selectCandidate(evidence, key, estimate.id, by) : evidence;
}

/** 「其餘接受估算」: every unresolved value that only has estimates. Conflicts still need a choice. */
export function acceptRemainingEstimates(evidence: ModelEvidence, by: string): ModelEvidence {
  let next = evidence;
  for (const d of evidence.dimensions) {
    if (d.status === 'missing') next = acceptEstimate(next, d.key, by);
  }
  return next;
}

/** Confirm every pending value whose measured sources agree. */
export function confirmAgreed(evidence: ModelEvidence, by: string): ModelEvidence {
  let next = evidence;
  for (const d of evidence.dimensions) {
    if (d.status !== 'pending') continue;
    const measured = usableCandidates(d, evidence.product_scope).find(isMeasured);
    if (measured) next = selectCandidate(next, d.key, measured.id, by);
  }
  return next;
}

const LABEL_KEYS: Record<string, string> = {
  width: 'width', depth: 'depth', height: 'height',
  top_thickness: 'top_thickness', leg_span_x: 'leg_span_x', leg_span_y: 'leg_span_y', seat_height: 'seat_height',
};

export interface EvidenceInput {
  productScope: ModelEvidence['product_scope'];
  catalog: Partial<Record<OverallKey, number | null>>;
  /** What the catalogue size describes, as read by the AI. */
  catalogScope?: DimensionScope;
  /** The AI's single consolidated overall estimate. */
  aiOverall?: Partial<Record<OverallKey, number | null>>;
  /** Per-view readings the AI reported. */
  estimates?: DimensionEstimate[];
  labels?: LabelledDimension[];
  /** Structure values read off the part list. */
  keyDimensions?: KeyDimension[];
  /** The draft being replaced: people's choices survive a new AI reading (AC-06). */
  previous?: ModelEvidence;
}

export function buildEvidence(input: EvidenceInput): ModelEvidence {
  const records = new Map<string, DimensionRecord>();
  const record = (key: string, label: string) => {
    let r = records.get(key);
    if (!r) records.set(key, (r = { key, label, critical: true, candidates: [], status: 'missing' }));
    return r;
  };
  const add = (key: string, c: Omit<DimensionCandidate, 'id'>) => {
    const r = records.get(key);
    if (!r || !positive(c.value_mm)) return;
    const id = `${c.source}-${r.candidates.filter((x) => x.source === c.source).length + 1}`;
    r.candidates.push({ ...c, value_mm: round(c.value_mm), id });
  };
  const single: DimensionScope = input.productScope === 'single' ? 'single' : 'arrangement';
  for (const key of OVERALL_KEYS) {
    record(key, OVERALL_LABEL[key]);
    const cat = input.catalog[key];
    if (positive(cat)) add(key, { source: 'catalog', value_mm: cat, unit: 'mm', method: '產品尺寸欄位', scope: input.catalogScope === 'arrangement' ? 'arrangement' : 'unknown' });
    const ai = input.aiOverall?.[key];
    if (positive(ai)) add(key, { source: 'ai_photo', value_mm: ai, method: 'AI 綜合照片估算', scope: single });
    for (const row of input.estimates ?? []) {
      const v = row[`${key}_mm` as const];
      if (positive(v) && !records.get(key)!.candidates.some((c) => c.source === 'ai_photo' && Math.abs(c.value_mm - v) <= MEASURED_TOLERANCE_MM)) {
        add(key, { source: 'ai_photo', value_mm: v, method: `AI 讀取${row.view ? `（${row.view}）` : ''}`, scope: single });
      }
    }
  }
  const shelves = (input.keyDimensions ?? []).filter((k) => k.key.startsWith('shelf_'));
  for (const k of input.keyDimensions ?? []) {
    record(k.key, k.label);
    add(k.key, { source: 'model', value_mm: k.value_mm, method: '按零件推算', scope: single });
  }
  for (const label of input.labels ?? []) {
    if (!positive(label.value)) continue;
    const value_mm = toMm(label.value, label.unit);
    let key = LABEL_KEYS[label.dimension];
    if (!key && label.dimension === 'shelf_height' && shelves.length) {
      key = shelves.reduce((best, s) => (Math.abs(s.value_mm - value_mm) < Math.abs(best.value_mm - value_mm) ? s : best)).key;
    }
    if (!key || !records.has(key)) continue;
    add(key, {
      source: 'drawing_label',
      value_mm,
      raw_value: label.value,
      unit: label.unit,
      raw_text: label.raw_text?.slice(0, 80),
      method: 'AI 讀取圖紙標註，待核對',
      location: label.location?.slice(0, 80) ?? undefined,
      image_index: label.image_index ?? undefined,
      scope: label.applies_to ?? 'unknown',
    });
  }
  for (const prev of input.previous?.dimensions ?? []) {
    const r = records.get(prev.key) ?? (prev.selected_id ? record(prev.key, prev.label) : undefined);
    if (!r || !prev.selected_id) continue;
    const chosen = prev.candidates.find((c) => c.id === prev.selected_id);
    if (!chosen) continue;
    // A confirmed measured value is kept as is; an accepted estimate is re-read from the new geometry.
    if (isEstimate(chosen)) {
      const fresh = r.candidates.find((c) => c.source === chosen.source);
      if (fresh) Object.assign(r, { selected_id: fresh.id, confirmed_by: prev.confirmed_by, confirmed_at: prev.confirmed_at });
      continue;
    }
    const same = r.candidates.find((c) => c.source === chosen.source && Math.abs(c.value_mm - chosen.value_mm) <= 0.05);
    const id = same?.id ?? chosen.id;
    if (!same) r.candidates = [...r.candidates.filter((c) => c.id !== chosen.id), chosen];
    Object.assign(r, { selected_id: id, reason: prev.reason ?? null, confirmed_by: prev.confirmed_by, confirmed_at: prev.confirmed_at });
  }
  return withStatuses({ version: 1, product_scope: input.productScope, dimensions: [...records.values()], blockers: [] });
}

/**
 * A part edit changed an overall size. The new value is recorded as a parts-derived estimate:
 * it replaces an accepted estimate, but never a confirmed value, and disagreeing with measured
 * data shows up as a conflict instead of silently winning.
 */
export function setModelOverall(evidence: ModelEvidence, key: OverallKey, value_mm: number, by: string): ModelEvidence {
  return mapDimensions(evidence, key, (d) => {
    const candidates = [...d.candidates.filter((c) => c.id !== 'model-overall'), { id: 'model-overall', source: 'model' as const, value_mm: round(value_mm), method: '按修改後的部件推算', scope: 'unknown' as const }];
    const selected = d.candidates.find((c) => c.id === d.selected_id);
    const follow = (selected && isEstimate(selected)) || (!selected && !usableCandidates(d, evidence.product_scope).some(isMeasured));
    return follow ? { ...d, candidates, selected_id: 'model-overall', ...stamp(by) } : { ...d, candidates };
  });
}

/** New structure readings (from edited parts) replace the model candidates; choices stay. */
export function refreshKeyDimensions(evidence: ModelEvidence, keyDimensions: KeyDimension[]): ModelEvidence {
  const keys = new Set(keyDimensions.map((k) => k.key));
  const dimensions = evidence.dimensions
    .filter((d) => (OVERALL_KEYS as readonly string[]).includes(d.key) || keys.has(d.key) || d.selected_id)
    .map((d) => ({ ...d, candidates: d.candidates.filter((c) => c.id !== 'model-1') }));
  for (const k of keyDimensions) {
    let d = dimensions.find((x) => x.key === k.key);
    if (!d) dimensions.push((d = { key: k.key, label: k.label, critical: true, candidates: [], status: 'missing' }));
    d.candidates.push({ id: 'model-1', source: 'model', value_mm: k.value_mm, method: '按零件推算', scope: evidence.product_scope === 'single' ? 'single' : 'arrangement' });
  }
  return withStatuses({ ...evidence, dimensions });
}

/** Read the `labelled_dimensions` array from the analysis response defensively. */
export function labelledDimensionsFrom(rows: unknown): LabelledDimension[] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 24).flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    const unit = ['mm', 'cm', 'm', 'in'].includes(String(r.unit)) ? (r.unit as LengthUnit) : null;
    if (!positive(r.value) || !unit || typeof r.dimension !== 'string' || typeof r.raw_text !== 'string') return [];
    return [{
      dimension: r.dimension,
      value: r.value,
      unit,
      raw_text: r.raw_text.slice(0, 80),
      image_index: Number.isInteger(r.image_index) ? (r.image_index as number) : null,
      location: typeof r.location === 'string' ? r.location.slice(0, 80) : null,
      applies_to: ['single', 'arrangement', 'unknown'].includes(String(r.applies_to)) ? (r.applies_to as DimensionScope) : 'unknown',
    }];
  });
}
