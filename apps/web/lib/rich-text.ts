import { sanitizeWikiHtml } from './wiki-html';

/**
 * Bodies members write, and how they are safely read back.
 *
 * Posts, comments, replies and messages were stored and rendered as plain
 * text. Making them rich means the same field now holds HTML — so every read
 * path has to sanitise, and every read path also has to keep working for the
 * plain text already in the database.
 *
 * Nothing is migrated. A body written last week has no tags in it, and
 * rewriting a co-op's own words to add some would be a worse idea than
 * detecting the difference: `looksLikeHtml` decides per body, so old messages
 * keep their line breaks and new ones keep their formatting.
 */

/**
 * Whether a stored body was written by the rich composer.
 *
 * Deliberately narrow: a tag we actually produce, not any `<`. Somebody typing
 * "a < b" in a plain message must not have it treated as markup — that is how
 * a legitimate message ends up half-swallowed by a sanitiser.
 */
const RICH_TAG = /<(p|div|br|strong|b|em|i|u|s|a|blockquote|ul|ol|li|h[1-6]|code|pre)\b[^>]*>/i;

export function looksLikeHtml(body: string): boolean {
  return RICH_TAG.test(body);
}

/**
 * The entities a contentEditable leaves in a body that has no tags (CMN-26).
 *
 * A browser writes `&nbsp;` for a space it must not collapse — a double
 * space, or a space at the end of a line. Type "Cool!  I'll be there!" and
 * what is stored is `Cool!&nbsp; I'll be there!`, with no tag anywhere in it.
 *
 * `looksLikeHtml` then says no, correctly by its own rule, and the body goes
 * down the plain-text path to be escaped — turning `&nbsp;` into
 * `&amp;nbsp;`, which the browser renders as the literal text "&nbsp;". Six
 * bodies on production read that way, including Eddie Hickerson's "The new
 * system looks awesome.&nbsp;".
 *
 * Decoded before escaping rather than routed through the sanitiser: the
 * plain-text path is what preserves a member's line breaks and lets "a < b"
 * survive intact, and both of those are worth more than the one case this
 * fixes. The set is deliberately the handful a contentEditable actually
 * emits — decoding everything would mean a member who typed `&copy;` on
 * purpose sees a © they did not ask for.
 */
const COMPOSER_ENTITIES: ReadonlyArray<[RegExp, string]> = [
  [/&nbsp;|&#160;|&#xa0;/gi, '\u00a0'],
  [/&zwj;|&#8205;/gi, ''],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  /*
    `&amp;` last, and this order matters.

    Decoding it first would turn `&amp;lt;` — an ampersand the member actually
    typed, followed by "lt;" — into `&lt;` and then into a `<` they never
    wrote. Going the other way round, the literal stays literal.
  */
  [/&amp;/gi, '&'],
];

export function decodeComposerEntities(text: string): string {
  return COMPOSER_ENTITIES.reduce((out, [pattern, char]) => out.replace(pattern, char), text);
}

/**
 * The HTML to render for a stored body.
 *
 * Always sanitised — the API accepts what a browser sent, and a browser is not
 * a trusted source. Plain text is escaped rather than sanitised, so that "a <
 * b" survives intact and newlines are preserved by the caller's CSS.
 */
export function renderBodyHtml(body: string): string {
  // Decoded first: a tagless body still came from a contentEditable, and the
  // entities in it are the browser's encoding rather than something a member
  // typed (CMN-26).
  if (!looksLikeHtml(body)) return escapeHtml(decodeComposerEntities(body));
  return numberedIndent(dropEmptyBlocks(sanitizeWikiHtml(divsToParagraphs(body))));
}

/**
 * `<div>` is what a contentEditable actually produces (CNT-01).
 *
 * A browser wraps each line of a contentEditable in a `<div>`, and `div` is
 * not on the sanitiser's allowlist — DOMPurify keeps a disallowed element's
 * children, so `<div>a</div><div>b</div>` was rendered as `ab`. The Code of
 * Conduct read "…risk expulsion from the cooperative.1. We are all in this
 * together…", with the paragraph break simply gone.
 *
 * It only showed on *some* paragraphs, which is what made it look arbitrary:
 * where the spacer line was `<div><br></div>` the `<br>` survived and produced
 * a line break, and where it was `<div>&zwj;</div>` — what pasting from
 * another editor leaves behind — nothing survived at all.
 *
 * Converting rather than allowing `div`: a paragraph is what these are, the
 * CSS already spaces paragraphs, and nested divs flatten on their own here
 * because an HTML parser closes an open `<p>` when another one starts.
 */
function divsToParagraphs(html: string): string {
  /*
    Flattened here rather than left to the parser (OPS-35).

    This used to produce nested `<p>` from the nested `<div>` a
    contentEditable emits, and rely on the sanitiser's HTML parser to close
    an open paragraph when the next one opened. That was true of DOMPurify,
    which builds a DOM and serialises it back; it is not true of `xss`, which
    filters a stream and leaves structure alone — so swapping the sanitiser
    turned the Code of Conduct back into one nested block.

    Depending on a parser to repair our own malformed output was the weak
    part, so it does not any more: each `<div>` closes whatever paragraph is
    open before opening its own, and the unmatched closers are dropped.
  */
  let depth = 0;
  const flattened = html
    .replace(/<div\b[^>]*>/gi, () => {
      const open = depth > 0 ? '</p>' : '';
      depth += 1;
      return `${open}<p>`;
    })
    .replace(/<\/div>/gi, () => {
      if (depth === 0) return '';
      depth -= 1;
      // Only the innermost close ends a paragraph; the outer ones were
      // wrappers and their paragraph was already closed by the div inside.
      return depth === 0 ? '</p>' : '';
    });

  // A `<div>` left open by the browser leaves a paragraph open here.
  return depth > 0 ? `${flattened}</p>` : flattened;
}

/**
 * Drop the blank lines somebody typed between paragraphs.
 *
 * They were doing the spacing by hand, in an editor that gave them none. The
 * reader adds a paragraph's worth of margin, so keeping the empty block too
 * would double every gap. An image or a rule is not blank.
 */
function dropEmptyBlocks(html: string): string {
  return html.replace(/<p>([\s\S]*?)<\/p>/gi, (whole, inner: string) => {
    if (/<(img|hr)\b/i.test(inner)) return whole;
    const text = inner
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, '')
      .replace(/[\s\u200b-\u200d\ufeff]/g, '');
    return text === '' ? '' : whole;
  });
}

/**
 * Hang the indent on a paragraph the author numbered themselves (CNT-01).
 *
 * Charley, pointing at Circle: numbered items should indent, so a wrapped line
 * sits under the words rather than under the number. MaybeOS deliberately does
 * not convert "1." into a real `<ol>` — the editor promises not to renumber
 * anything you wrote, and an `<ol>` renumbers by definition. So the numbers
 * stay exactly as typed and only the indent is ours.
 *
 * Applied after sanitising, because `class` is not an allowed attribute — the
 * value is a constant here, never anything the author wrote.
 */
function numberedIndent(html: string): string {
  return html.replace(
    /<p>(\s*(?:<(?:strong|b|em|i|u|s)>\s*)*)(\d{1,3}[.)])(\s|&nbsp;)/gi,
    '<p class="rich-num">$1$2$3',
  );
}

/**
 * The anchor to insert when somebody links with nothing selected (CNT-02).
 *
 * `createLink` on a collapsed selection does nothing at all, so the button
 * looked broken; every other editor inserts the address as its own link.
 *
 * Escaped, because this is about to be markup. The composer already refuses
 * anything that is not `http(s)://` with no whitespace — which does not
 * exclude a quote, and a quote is all it takes to leave the href.
 */
export function linkHtml(url: string): string {
  const safe = escapeHtml(url.trim());
  return `<a href="${safe}">${safe}</a>`;
}

/** Minimal escaping for text that was never markup. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Whether a composer's contents amount to anything.
 *
 * A contenteditable that has been focused and emptied still contains `<br>` or
 * an empty paragraph, so `body.length` is not the question — otherwise Send
 * stays enabled on an empty box and posts a blank comment.
 */
export function isBlankBody(html: string): boolean {
  return sanitizeWikiHtml(html).replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '') === '';
}

/**
 * What to store for a body the rich composer produced.
 *
 * `renderBodyHtml` decides how to read a body back by looking for a tag the
 * composer emits — so a body with no formatting at all is read as plain text
 * and *escaped* on the way out. That is right for the plain text already in
 * the database and wrong for anything the composer just produced, because a
 * contentEditable hands back `a &lt; b` for the typed characters `a < b`. Read
 * back as plain text, that entity gets escaped again and the reader sees
 * `a &lt; b` on screen.
 *
 * Wrapping unformatted output in a `<p>` settles it: the body is unambiguously
 * HTML, is sanitised rather than escaped on the way out, and survives being
 * edited and saved any number of times. Nothing already stored is touched.
 */
export function asRichBody(html: string): string {
  const value = sanitizeWikiHtml(html).trim();
  return looksLikeHtml(value) ? value : `<p>${value}</p>`;
}
