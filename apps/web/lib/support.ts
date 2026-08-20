/**
 * How a co-op reaches MaybeOS when something is wrong (PLT-04).
 *
 * This is the whole of the support mechanism, and that is a decision rather
 * than a gap. The obvious alternative was "view as" — a platform admin seeing
 * what a member sees — which is the practical answer to "the button doesn't
 * work" and is also **the privacy rule with a door in it**. PLT-01 spent its
 * entire design closing that door: `PLATFORM_ADMIN` grants nothing inside a
 * co-op, and a support tool that reopened it would make that decorative.
 *
 * Charley's call, 2026-08-20: co-ops send a screenshot. It costs a support
 * round trip and it means **no member's data ever leaves their co-op for a
 * support reason** — which is the trade, stated plainly rather than buried.
 *
 * One constant, because an address copied into three components is an address
 * that gets changed in two of them.
 */
export const SUPPORT_EMAIL = 'support@maybeos.org';

/** A `mailto:` that arrives with the co-op already identified. */
export function supportMailto(orgName?: string, subject?: string): string {
  const line = subject ?? 'MaybeOS support';
  const withOrg = orgName ? `${line} — ${orgName}` : line;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(withOrg)}`;
}
