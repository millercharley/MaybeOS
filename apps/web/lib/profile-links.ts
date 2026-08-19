/**
 * How a member's links are shown, and which ones are shown at all.
 *
 * These are typed by one member and rendered as anchors on a page every other
 * member reads, so both halves of this file are safety rather than polish.
 *
 * The API validates on the way in (http/https, absolute). This validates again
 * on the way out, because rows predating the rule, a future import, or a
 * direct database edit would otherwise reach an `href` unchecked — and the
 * cost of being wrong is script running under the co-op's own domain.
 */

/** Only ever these two. `javascript:` and `data:` are the reason this exists. */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

export function isSafeProfileLink(raw: string): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(raw).protocol);
  } catch {
    // Unparseable is not safe. A relative string would resolve inside MaybeOS.
    return false;
  }
}

/**
 * What to print for a link.
 *
 * The host and path, without the scheme or a trailing slash — which is how
 * people write these addresses to each other, and how Circle shows them. Falls
 * back to the raw string only when it somehow parses as safe but not as
 * something displayable.
 */
export function profileLinkLabel(raw: string): string {
  try {
    const url = new URL(raw);
    const shown = `${url.host}${url.pathname}`.replace(/\/$/, '');
    return shown.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

/** The safe subset, in the order the member arranged them. */
export function safeProfileLinks(links?: string[] | null): string[] {
  return (links ?? []).filter(isSafeProfileLink);
}
