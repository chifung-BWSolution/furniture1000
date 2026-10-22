/** Ordered results with a bounded number of requests in flight. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  map: (item: T, index: number) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await map(items[index], index);
    }
  }));
  return results;
}
