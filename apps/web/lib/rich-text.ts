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
const RICH_TAG = /<(p|br|strong|b|em|i|u|s|a|blockquote|ul|ol|li|h[1-6]|code|pre)\b[^>]*>/i;

export function looksLikeHtml(body: string): boolean {
  return RICH_TAG.test(body);
}

/**
 * The HTML to render for a stored body.
 *
 * Always sanitised — the API accepts what a browser sent, and a browser is not
 * a trusted source. Plain text is escaped rather than sanitised, so that "a <
 * b" survives intact and newlines are preserved by the caller's CSS.
 */
export function renderBodyHtml(body: string): string {
  return looksLikeHtml(body) ? sanitizeWikiHtml(body) : escapeHtml(body);
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
