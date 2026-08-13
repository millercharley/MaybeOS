/**
 * The connection settings that keep production up, held in the repository
 * rather than inside a secret (OPS-11, D-018).
 *
 * MaybeOS runs as a Netlify Function. Every warm Lambda container is a separate
 * process with its own Prisma pool, and Prisma's default pool size is
 * `physical CPUs × 2 + 1` — three to five connections per container. Supabase's
 * session-mode pooler allows **15 clients in total**, so four or five warm
 * containers exhaust it and every request afterwards fails to initialise with
 * `max clients reached in session mode`. Not slowly: the API returns 502 to
 * everybody, including the login page.
 *
 * That happened on 2026-08-11 (OPS-11), was fixed by putting `connection_limit`
 * into `DATABASE_URL`, and happened again on 2026-08-13 after five deploys in
 * quick succession. **The fix had been invisible.** It lived only inside a
 * secret, where nothing in the repository referenced it, no test covered it,
 * and any edit to that variable silently removed it. A protection you cannot
 * see is one you cannot keep.
 *
 * So it lives here now. Whatever `DATABASE_URL` says, the runtime forces:
 *
 *   - `connection_limit=1` — one connection per container, so the 15-client
 *     ceiling means fifteen concurrent containers rather than three.
 *   - `pool_timeout=10` — wait briefly for a free connection instead of
 *     failing instantly under a burst.
 *   - `connect_timeout=10` — fail a hung connect attempt rather than holding
 *     the request open.
 *
 * An explicit value already in the URL is respected, so this can still be
 * tuned from the environment without a deploy — it sets a floor, not a cage.
 */

/** What the runtime insists on unless the URL already says otherwise. */
export const CONNECTION_DEFAULTS: Record<string, string> = {
  connection_limit: '1',
  pool_timeout: '10',
  connect_timeout: '10',
};

/**
 * Apply the defaults above to a Postgres connection string.
 *
 * Returns the input unchanged if it is missing or unparseable — a malformed
 * URL is Prisma's error to report, with its own far better message, and
 * throwing here would replace it with a stack trace from a helper.
 */
export function withConnectionDefaults(
  url: string | undefined,
  defaults: Record<string, string> = CONNECTION_DEFAULTS,
): string | undefined {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, value);
    }
  }

  return parsed.toString();
}
