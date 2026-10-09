/**
 * Collapsing per-row read cutoffs into as few query clauses as possible
 * (CMN-25).
 *
 * The unread badges used to count one row at a time: a `count` per channel
 * for posts, another per channel for comments, and another per thread for
 * messages. Each one is cheap and all of them went out at once, which is the
 * trap — a handful of channels turns a badge into a dozen parallel round
 * trips, from every signed-in page, on a sixty-second timer. The connection
 * pool, not the query planner, is what runs out.
 *
 * They cannot simply be added together, because each row has its own cutoff:
 * a member has read one channel up to Tuesday and another not at all. But
 * most members have read almost nothing, so most of those cutoffs are the
 * same date — the day they joined. Grouping by cutoff turns the usual case
 * into a single `IN (...)` and the whole badge into two queries.
 */

export interface ReadWindow {
  /** The rows that share this cutoff. */
  ids: string[];
  /** Count what arrived after this; null counts everything. */
  after: Date | null;
}

/**
 * One window per distinct cutoff, each naming every id that shares it.
 *
 * Ordered by cutoff so the clauses a query ends up with are stable — two
 * identical requests should produce the same SQL, or the database plans each
 * one afresh.
 */
export function readWindows(rows: { id: string; after: Date | null }[]): ReadWindow[] {
  const byCutoff = new Map<number, string[]>();

  for (const row of rows) {
    // A null cutoff means "count everything", which is its own group. -1 is
    // safe as its key: a real cutoff is a date, and no date we store is
    // before 1970.
    const key = row.after ? row.after.getTime() : -1;
    const ids = byCutoff.get(key);
    if (ids) ids.push(row.id);
    else byCutoff.set(key, [row.id]);
  }

  return [...byCutoff.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, ids]) => ({ ids, after: key === -1 ? null : new Date(key) }));
}
