/**
 * Runs `fn` over `items` with at most `limit` concurrent promises. Results are
 * collected in input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/**
 * Like mapWithConcurrency, but also caps the total `sizeOf` of items in
 * flight at `budget`: items start in order while they fit (and at most
 * `maxConcurrent` at once), and one item always runs even if it alone exceeds
 * the budget. Stops starting new items after the first failure. Results are
 * collected in input order.
 */
export function mapWithByteBudget<T, R>(
  items: T[],
  budget: number,
  sizeOf: (item: T) => number,
  fn: (item: T, index: number) => Promise<R>,
  maxConcurrent = 3,
): Promise<R[]> {
  return new Promise((resolve, reject) => {
    const results = new Array<R>(items.length);
    if (items.length === 0) return resolve(results);
    let next = 0;
    let active = 0;
    let activeBytes = 0;
    let done = 0;
    let failed = false;
    const pump = () => {
      while (!failed && next < items.length && active < maxConcurrent) {
        const size = sizeOf(items[next]);
        if (active > 0 && activeBytes + size > budget) break;
        const i = next++;
        active++;
        activeBytes += size;
        fn(items[i], i).then(
          (r) => {
            results[i] = r;
            active--;
            activeBytes -= size;
            if (++done === items.length) resolve(results);
            else pump();
          },
          (e) => {
            failed = true;
            reject(e);
          },
        );
      }
    };
    pump();
  });
}