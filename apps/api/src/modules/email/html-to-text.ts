/**
 * The plain-text half of every message (EML-02).
 *
 * MaybeOS sent `HtmlBody` and nothing else. A message with no text
 * alternative has been a spam signal for twenty years, for the plain reason
 * that bulk senders skip the work and correspondents do not — and Microsoft
 * weights it a good deal more heavily than Gmail does, which is the
 * asymmetry the roster shows: Gmail members signed in, Outlook members never
 * saw the mail at all.
 *
 * Generated from the HTML rather than written twice. Two hand-maintained
 * bodies drift, and the one that drifts is always the one nobody reads —
 * right up to the day a member reads it because their client prefers text.
 *
 * The input is MaybeOS's own templates, which are well-formed and already
 * escaped. This is deliberately not a general HTML parser: it is a reduction
 * of known markup, written to fail towards readable text rather than towards
 * correctness on markup it will never see.
 */

/** Tags whose content is machinery, not prose. */
const INVISIBLE = /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Tags that end a line wherever they appear. */
const BREAKS = /<\s*(br|\/p|\/div|\/h[1-6]|\/tr|\/table|\/ul|\/ol|\/blockquote)\b[^>]*>/gi;

/** Tags that start a block, so text does not run on from what came before. */
const BLOCK_STARTS = /<\s*(p|div|h[1-6]|tr|table|ul|ol|blockquote)\b[^>]*>/gi;

const LIST_ITEM = /<\s*li\b[^>]*>/gi;

/**
 * An anchor, reduced to its label and its destination.
 *
 * The destination has to survive. Every message MaybeOS sends exists to get
 * somebody to a URL — a sign-in link, a booking, an article — and a text
 * part that renders "Sign in" with nowhere to go is worse than no text part
 * at all, because it is the version some clients choose to show.
 */
const ANCHOR = /<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;

const TAG = /<[^>]+>/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Code points outside Unicode, and the surrogate range, throw rather
      // than returning something wrong — the original text is the safer
      // answer when a numeric entity is nonsense.
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * A readable plain-text rendering of one of our HTML emails.
 *
 * Never returns an empty string for non-empty input that had any prose in it,
 * because Postmark rejects a `TextBody` of `''` as a missing body — and the
 * caller must be able to pass the result straight through.
 */
export function htmlToText(html: string): string {
  if (!html) return '';

  let text = html.replace(INVISIBLE, ' ');

  text = text.replace(ANCHOR, (_whole, _q, dq, sq, bare, label: string) => {
    const href = decodeEntities((dq ?? sq ?? bare ?? '').trim());
    const words = decodeEntities(label.replace(TAG, ' ')).replace(/\s+/g, ' ').trim();

    if (!href) return words;
    // A link whose label is already the URL reads as a stutter when expanded
    // — "https://… (https://…)" — and these templates do print bare URLs.
    if (!words || words === href) return href;
    return `${words} (${href})`;
  });

  text = text.replace(LIST_ITEM, '\n- ');
  text = text.replace(BREAKS, '\n');
  text = text.replace(BLOCK_STARTS, '\n');
  text = text.replace(TAG, '');
  text = decodeEntities(text);

  return text
    // Spaces and tabs collapse; newlines are structure and must survive the
    // collapse, which a bare \s+ would destroy.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/[^\S\n]*\n[^\S\n]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
