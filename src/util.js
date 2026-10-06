// Small shared helpers: logging (to stderr so stdout stays clean HTML),
// sleeping, and bounded-concurrency mapping.

function line(level, msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] ${level.padEnd(5)} ${msg}\n`);
}

export const warn = (m) => line("WARN", m);
export const error = (m) => line("ERROR", m);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run `fn` over `items` with at most `limit` in flight at once.
// Results are returned in the original order.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}
