/**
 * Find clusters of similar products for 已上載產品 → 找相似產品.
 *
 * Criteria:
 * 1. Same product title (exact trim) AND same factory/vendor
 * 2. Same SKU (exact) OR ~90% similar (e.g. CYJ-DQ-13O vs CYJ-DQ-13O-1)
 */

export interface SimilarProductInput {
  id: string;
  title: string;
  factory: string;
  sku: string;
}

export type SimilarProductCriterion = 'name' | 'sku';

export interface SimilarProductGroup<T extends SimilarProductInput = SimilarProductInput> {
  id: string;
  /** Display label — usually product title or base SKU. */
  label: string;
  criterion: SimilarProductCriterion | 'mixed';
  products: T[];
}

function normalizeTitle(title: string): string {
  return title.trim();
}

function normalizeFactory(factory: string): string {
  return factory.trim();
}

export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** Strip common trailing variant suffixes: -1, -01, -A, _1, etc. */
export function skuBaseKey(sku: string): string {
  const n = normalizeSku(sku);
  if (!n || n === '—') return '';
  return n.replace(/[-_][0-9A-Z]{1,3}$/i, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const prev = new Array<number>(cols);
  const curr = new Array<number>(cols);
  for (let j = 0; j < cols; j++) prev[j] = j;
  for (let i = 1; i < rows; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j < cols; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j < cols; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Similarity ratio in [0, 1] via Levenshtein. */
export function skuSimilarityRatio(a: string, b: string): number {
  const na = normalizeSku(a);
  const nb = normalizeSku(b);
  if (!na || !nb || na === '—' || nb === '—') return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * SKUs are similar when exact, share a variant base (prefix + -N),
 * or Levenshtein similarity ≥ 0.9.
 */
export function areSkusSimilar(a: string, b: string, threshold = 0.9): boolean {
  const na = normalizeSku(a);
  const nb = normalizeSku(b);
  if (!na || !nb || na === '—' || nb === '—') return false;
  if (na === nb) return true;

  const baseA = skuBaseKey(na);
  const baseB = skuBaseKey(nb);
  if (baseA && baseB && baseA === baseB) return true;

  // One is a near-prefix variant of the other (e.g. FOO vs FOO-1)
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (
    longer.startsWith(shorter) &&
    /^[-_][0-9A-Z]{1,3}$/i.test(longer.slice(shorter.length))
  ) {
    return true;
  }

  return skuSimilarityRatio(na, nb) >= threshold;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(id: string): string {
    let p = this.parent.get(id) ?? id;
    if (!this.parent.has(id)) this.parent.set(id, id);
    while (p !== (this.parent.get(p) ?? p)) {
      const grand = this.parent.get(p) ?? p;
      this.parent.set(p, this.parent.get(grand) ?? grand);
      p = this.parent.get(p) ?? p;
    }
    return p;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    this.parent.set(rb, ra);
  }
}

export function findSimilarProductGroups<T extends SimilarProductInput>(
  products: T[],
  criteria: SimilarProductCriterion[],
): SimilarProductGroup<T>[] {
  const enabled = new Set(criteria);
  if (enabled.size === 0 || products.length < 2) return [];

  const uf = new UnionFind();
  const criterionHint = new Map<string, Set<SimilarProductCriterion>>();

  const mark = (id: string, c: SimilarProductCriterion) => {
    const set = criterionHint.get(id) ?? new Set();
    set.add(c);
    criterionHint.set(id, set);
  };

  if (enabled.has('name')) {
    const byKey = new Map<string, T[]>();
    for (const p of products) {
      const title = normalizeTitle(p.title);
      const factory = normalizeFactory(p.factory);
      if (!title || title === '(未命名)' || !factory || factory === '—') continue;
      const key = `${title}\0${factory}`;
      const list = byKey.get(key) ?? [];
      list.push(p);
      byKey.set(key, list);
    }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i++) {
        uf.union(list[0].id, list[i].id);
      }
      for (const p of list) mark(p.id, 'name');
    }
  }

  if (enabled.has('sku')) {
    const withSku = products.filter((p) => {
      const s = normalizeSku(p.sku);
      return Boolean(s) && s !== '—';
    });
    for (let i = 0; i < withSku.length; i++) {
      for (let j = i + 1; j < withSku.length; j++) {
        if (areSkusSimilar(withSku[i].sku, withSku[j].sku)) {
          uf.union(withSku[i].id, withSku[j].id);
          mark(withSku[i].id, 'sku');
          mark(withSku[j].id, 'sku');
        }
      }
    }
  }

  const buckets = new Map<string, T[]>();
  for (const p of products) {
    const root = uf.find(p.id);
    // Only keep products that were actually linked by a criterion
    if (!criterionHint.has(p.id)) continue;
    const list = buckets.get(root) ?? [];
    list.push(p);
    buckets.set(root, list);
  }

  const groups: SimilarProductGroup<T>[] = [];
  for (const [root, list] of buckets) {
    if (list.length < 2) continue;
    const hints = new Set<SimilarProductCriterion>();
    for (const p of list) {
      for (const c of criterionHint.get(p.id) ?? []) hints.add(c);
    }
    const criterion: SimilarProductCriterion | 'mixed' =
      hints.size === 1 ? [...hints][0]! : 'mixed';

    const label =
      normalizeTitle(list[0].title) ||
      normalizeSku(list[0].sku) ||
      '相似產品';

    list.sort((a, b) =>
      normalizeSku(a.sku).localeCompare(normalizeSku(b.sku), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );

    groups.push({
      id: root,
      label,
      criterion,
      products: list,
    });
  }

  // Stable order: larger groups first, then label
  groups.sort((a, b) => {
    if (b.products.length !== a.products.length) {
      return b.products.length - a.products.length;
    }
    return a.label.localeCompare(b.label, 'zh-Hant');
  });

  return groups;
}
