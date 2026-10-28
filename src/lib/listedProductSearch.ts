/** Apply the same server-side substring search to the count and page queries. */
export function applyListedProductSearch<T extends { or: (filters: string) => T }>(query: T, search: string): T {
  const term = search.trim();
  if (!term) return query;
  // Quote PostgREST values so punctuation in product codes cannot alter the filter.
  const escaped = term.replace(/[\\%_]/g, '\\$&').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const pattern = `"%${escaped}%"`;
  return query.or(['title', 'sku', 'product_sku', 'model']
    .map(column => `${column}.ilike.${pattern}`).join(','));
}
