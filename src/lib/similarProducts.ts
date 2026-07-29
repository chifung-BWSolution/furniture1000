/**
 * Find clusters of similar products for 已上載產品 → 找相似產品.
 *
 * Criteria:
 * 1. Same product title (exact trim) AND same factory/vendor
 * 2. Same SKU stem (variant forms of one code), e.g.
 *    CUF-D366 / CUF-D366-1 / CUF-D366-A / CUF-D366A / CUFD366
 *    — NOT CUF-D366 vs CUF-D380 / CUF-D365
 *
 * When both are selected, matches must satisfy BOTH (AND), not either.
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

/** Compact SKU: letters + digits only. */
export function compactSku(sku: string): string {
  return normalizeSku(sku).replace(/[^A-Z0-9]/g, '');
}

/**
 * Canonical product-code stem for similarity.
 * Strips only short variant suffixes (-1, -A, glued A / 1), never the main product number.
 *
 * CUF-D366 / CUF-D366-1 / CUF-D366A / CUFD366 → CUFD366
 * CUF-D380 → CUFD380 (distinct)
 */
export function skuStem(sku: string): string {
  let n = normalizeSku(sku);
  if (!n || n === '—') return '';

  // Trailing separator variants only: -1, -A, -12, -1A (1–2 chars).
  // Do NOT strip -366 / -380 (3+ char product number segments).
  // Also keep codes like CYJ-DQ-13 (stripping -13 would leave no digits).
  const withoutSepVariant = n.replace(/[-_][0-9A-Z]{1,2}$/i, '');
  const withoutSepCompact = withoutSepVariant.replace(/[^A-Z0-9]/g, '');
  if (withoutSepCompact !== compactSku(n) && /\d/.test(withoutSepCompact)) {
    n = withoutSepVariant;
  }

  let c = n.replace(/[^A-Z0-9]/g, '');
  if (!c) return '';

  // Glued letter variant only after a product digit run (≥3 digits): CUFD366A → CUFD366
  // Keep short digit+letter model codes intact (e.g. CYJDQ13O).
  c = c.replace(/(\d{3,})([A-Z]{1,2})$/, '$1');

  // Glued short digit variant after a product digit run (≥3 digits): CUFD3661 → CUFD366
  // CUFD366 alone does not match (no extra 1–2 digit variant group).
  const glued = c.match(/^(.*\d{3,})(\d{1,2})$/);
  if (glued && /[A-Z]/.test(glued[1])) {
    c = glued[1];
  }

  return c;
}

/**
 * SKUs are similar only when they share the same product-code stem
 * (exact compact match, or variant suffixes of that stem).
 */
export function areSkusSimilar(a: string, b: string): boolean {
  const na = normalizeSku(a);
  const nb = normalizeSku(b);
  if (!na || !nb || na === '—' || nb === '—') return false;
  if (na === nb) return true;
  if (compactSku(na) === compactSku(nb)) return true;

  const stemA = skuStem(na);
  const stemB = skuStem(nb);
  if (!stemA || !stemB) return false;
  // Require a meaningful stem so tiny codes don't over-match
  if (stemA.length < 4 || stemB.length < 4) return stemA === stemB && compactSku(na) === compactSku(nb);
  return stemA === stemB;
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

/** Cluster products whose SKUs are exact / ~90% similar (union-find). */
function clusterBySimilarSku<T extends SimilarProductInput>(
  products: T[],
): T[][] {
  const withSku = products.filter((p) => {
    const s = normalizeSku(p.sku);
    return Boolean(s) && s !== '—';
  });
  if (withSku.length < 2) return [];

  const uf = new UnionFind();
  const linked = new Set<string>();
  for (let i = 0; i < withSku.length; i++) {
    for (let j = i + 1; j < withSku.length; j++) {
      if (areSkusSimilar(withSku[i].sku, withSku[j].sku)) {
        uf.union(withSku[i].id, withSku[j].id);
        linked.add(withSku[i].id);
        linked.add(withSku[j].id);
      }
    }
  }

  const buckets = new Map<string, T[]>();
  for (const p of withSku) {
    if (!linked.has(p.id)) continue;
    const root = uf.find(p.id);
    const list = buckets.get(root) ?? [];
    list.push(p);
    buckets.set(root, list);
  }
  return [...buckets.values()].filter((list) => list.length >= 2);
}

function groupByNameAndFactory<T extends SimilarProductInput>(
  products: T[],
): T[][] {
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
  return [...byKey.values()].filter((list) => list.length >= 2);
}

function toGroups<T extends SimilarProductInput>(
  clusters: T[][],
  criterion: SimilarProductCriterion | 'mixed',
): SimilarProductGroup<T>[] {
  const groups: SimilarProductGroup<T>[] = clusters.map((list) => {
    const sorted = [...list].sort((a, b) =>
      normalizeSku(a.sku).localeCompare(normalizeSku(b.sku), undefined, {
        numeric: true,
        sensitivity: 'base',
      }),
    );
    const label =
      normalizeTitle(sorted[0].title) ||
      normalizeSku(sorted[0].sku) ||
      '相似產品';
    return {
      id: sorted.map((p) => p.id).sort().join('|'),
      label,
      criterion,
      products: sorted,
    };
  });

  groups.sort((a, b) => {
    if (b.products.length !== a.products.length) {
      return b.products.length - a.products.length;
    }
    return a.label.localeCompare(b.label, 'zh-Hant');
  });
  return groups;
}

/**
 * Find similar-product clusters.
 * - name only: same title + same factory
 * - sku only: exact / ~90% similar SKU
 * - both: AND — same title + same factory, AND SKUs similar within that set
 */
export function findSimilarProductGroups<T extends SimilarProductInput>(
  products: T[],
  criteria: SimilarProductCriterion[],
): SimilarProductGroup<T>[] {
  const enabled = new Set(criteria);
  if (enabled.size === 0 || products.length < 2) return [];

  const useName = enabled.has('name');
  const useSku = enabled.has('sku');

  // Both selected → AND: name+factory groups, then SKU-similar subsets only
  if (useName && useSku) {
    const nameGroups = groupByNameAndFactory(products);
    const clusters: T[][] = [];
    for (const nameGroup of nameGroups) {
      clusters.push(...clusterBySimilarSku(nameGroup));
    }
    return toGroups(clusters, 'mixed');
  }

  if (useName) {
    return toGroups(groupByNameAndFactory(products), 'name');
  }

  if (useSku) {
    return toGroups(clusterBySimilarSku(products), 'sku');
  }

  return [];
}

/**
 * Pack ordered product groups into pages without splitting a group across pages.
 * If adding a group would exceed `pageSize`, start a new page.
 * A single group larger than `pageSize` still occupies one page by itself
 * so similar products always stay together.
 */
export function paginateKeepingGroups<T>(
  orderedGroups: readonly (readonly T[])[],
  pageSize: number,
): T[][] {
  const size = Math.max(1, Math.floor(Number(pageSize) || 1));
  const pages: T[][] = [];
  let page: T[] = [];
  let count = 0;

  for (const group of orderedGroups) {
    if (!group.length) continue;
    if (count > 0 && count + group.length > size) {
      pages.push(page);
      page = [];
      count = 0;
    }
    page.push(...group);
    count += group.length;
  }

  if (page.length > 0) pages.push(page);
  return pages;
}
