import { sanitizeWikiHtml } from './wiki-html';

/**
 * Keeping the formatting when somebody pastes (CMP-01).
 *
 * Charley, 2026-11-14: "I want to paste a rich text message with hyperlinks
 * and bold text into the Admin's view of the Commons so, as an admin, I can
 * also email every member. Right now when I paste that rich text, all of the
 * bold and hyperlinks are lost."
 *
 * They were lost on purpose. The composer called `preventDefault` and inserted
 * `text/plain`, with a comment explaining that a word processor "carries in
 * fonts, colours and background shading that the sanitiser strips unevenly, so
 * what lands rarely looks like what was copied". The observation was right and
 * the conclusion was too strong: the answer to a paste that arrives badly
 * formatted is not a paste that arrives unformatted.
 *
 * **The hard part is not the sanitiser. It is that bold does not arrive as
 * `<b>`.** `sanitizeWikiHtml` allows `strong`, `em`, `a`, `ul`, headings and
 * the rest, and drops `style`, `class`, `<font>` and `<span>` — which is
 * exactly right for safety and exactly wrong for a clipboard, because the
 * editors people actually paste from put the meaning *in the style*:
 *
 *   Google Docs   <span style="font-weight:700">text</span>
 *   Word          <span style='font-weight:bold;mso-bidi-font-weight:normal'>
 *   Outlook       <span style="text-decoration:underline">
 *   Apple Notes   <span style="font-weight: bold">
 *
 * Hand any of those straight to the sanitiser and the span goes, the style
 * goes, and the words arrive naked. So this runs first and turns presentation
 * back into meaning, and *then* the sanitiser runs as the security boundary it
 * is. Order matters and is not negotiable: normalise, then sanitise. Never the
 * other way round, and never instead.
 *
 * **The trap that would have shipped a document in bold.** Google Docs wraps
 * its entire fragment in `<b style="font-weight:normal" id="docs-internal-
 * guid-…">`. The `<b>` is on the sanitiser's allowlist, so simply allowing
 * paste-through would have kept it, dropped the style that cancels it, and
 * emboldened every word of every paste from Google Docs. An element whose own
 * style says it is *not* bold is unwrapped here before anything else can
 * believe the tag.
 *
 * **What this deliberately does not attempt.** Word writes list items as
 * `<p style="mso-list:l0 level1 lfo1">` with a literal bullet character in a
 * span, not as `<ul><li>`. Reconstructing real lists from that means parsing
 * Word's list bookkeeping, and getting it half-right produces a worse result
 * than a run of paragraphs — which is what those become. Real `<ul>` from
 * Google Docs, Outlook, Apple and the web all survive intact.
 */

/** Anything at or above 600 reads as bold; `bolder` is relative and assumed so. */
const BOLD_WEIGHT = /^(bold|bolder|[6-9]00)$/;

/**
 * Weights that cancel a `<b>`.
 *
 * `normal` is Google Docs' wrapper. The numbers are here because Word writes
 * `font-weight:400` for the same purpose, and a tag that says bold while its
 * own style says 400 is not bold.
 */
const NOT_BOLD_WEIGHT = /^(normal|lighter|[1-5]00)$/;

/** Block-level tags, for deciding whether a `<div>` is a paragraph or a box. */
const BLOCK = /^(P|DIV|UL|OL|LI|TABLE|THEAD|TBODY|TR|TD|TH|BLOCKQUOTE|H[1-6]|PRE|HR)$/;

/** Markup that is machinery rather than words. */
const JUNK = 'style, meta, link, title, script, noscript, o\\:p, w\\:sdt, xml';

/**
 * One declaration out of a `style` attribute.
 *
 * Anchored on `;` or the start so that Word's `mso-font-weight:normal` cannot
 * answer a question about `font-weight` — the character before it is a hyphen,
 * which neither anchor accepts. That one detail is the difference between
 * reading Word correctly and reading it inside out.
 */
function declaration(style: string, property: string): string | null {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(style);
  return found ? found[1].trim() : null;
}

/** Wrap an element's children in a tag, keeping them in order. */
function wrapChildren(el: Element, tag: string, doc: Document): void {
  if (!el.firstChild) return;
  const wrapper = doc.createElement(tag);
  while (el.firstChild) wrapper.appendChild(el.firstChild);
  el.appendChild(wrapper);
}

/** Replace an element with its own children. */
function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/**
 * Turn one element's presentation into semantics.
 *
 * Children are wrapped rather than the element replaced, because the element
 * may itself be meaningful — a `<p style="font-weight:bold">` is a paragraph
 * *and* bold, and replacing it with `<strong>` would lose the paragraph.
 */
function recoverSemantics(el: Element, doc: Document): void {
  const style = (el.getAttribute('style') ?? '').toLowerCase();
  if (!style) return;

  const weight = declaration(style, 'font-weight');
  const slant = declaration(style, 'font-style');

  /*
    The Google Docs wrapper, handled before anything is believed.

    `<b style="font-weight:normal">` is not an emphasis, it is a container
    Google Docs happens to spell with a `<b>`. Unwrapping returns here because
    the element no longer exists to carry anything else.
  */
  if (/^(B|STRONG)$/.test(el.tagName) && weight && NOT_BOLD_WEIGHT.test(weight)) {
    unwrap(el);
    return;
  }
  if (/^(I|EM)$/.test(el.tagName) && slant === 'normal') {
    unwrap(el);
    return;
  }

  // Innermost last, so the nesting reads strong > em > u > s from the outside.
  // Nothing depends on the order, but a stable one keeps the tests readable.
  const decoration = declaration(style, 'text-decoration')
    ?? declaration(style, 'text-decoration-line')
    ?? '';

  if (/^(S|STRIKE|DEL)$/.test(el.tagName) === false && decoration.includes('line-through')) {
    wrapChildren(el, 's', doc);
  }
  if (/^(U|INS)$/.test(el.tagName) === false && decoration.includes('underline')) {
    wrapChildren(el, 'u', doc);
  }
  if (/^(I|EM)$/.test(el.tagName) === false && (slant === 'italic' || slant === 'oblique')) {
    wrapChildren(el, 'em', doc);
  }
  if (/^(B|STRONG)$/.test(el.tagName) === false && weight && BOLD_WEIGHT.test(weight)) {
    wrapChildren(el, 'strong', doc);
  }
}

/** Comments, which is where Word keeps its conditional markup. */
function removeComments(root: Node): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 8) child.parentNode?.removeChild(child);
    else if (child.nodeType === 1) removeComments(child);
  }
}

/**
 * A clipboard's HTML, reduced to the formatting MaybeOS stores.
 *
 * Returns sanitised HTML ready to insert, or `''` when there was nothing in
 * it — the caller falls back to plain text, which is also what happens when a
 * clipboard carries no HTML at all. "Paste and match style" in Chrome and
 * Safari delivers only `text/plain`, so pasting without formatting keeps
 * working without this having to detect it.
 */
export function normalizePastedHtml(html: string): string {
  if (!html.trim()) return '';

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return '';

  removeComments(body);
  body.querySelectorAll(JUNK).forEach((node) => node.remove());

  /*
    A snapshot, because the walk inserts elements as it goes.

    `isConnected` is checked per element because unwrapping the Google Docs
    `<b>` removes a node this list still holds — and reading `tagName` off a
    detached node is harmless, while wrapping its children is not.
  */
  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (el.isConnected) recoverSemantics(el, doc);
  }

  /*
    `<div>` per line is how Outlook and Apple Mail write paragraphs, and the
    sanitiser drops a `div` while keeping its contents — so two lines arrive
    as one. Innermost first, so an outer div sees the paragraphs its children
    have already become and steps out of the way rather than nesting a `<p>`
    inside a `<p>`, which no serializer will keep.
  */
  for (const div of Array.from(body.querySelectorAll('div')).reverse()) {
    if (!div.isConnected) continue;

    const holdsBlocks = Array.from(div.children).some((child) => BLOCK.test(child.tagName));
    if (holdsBlocks) {
      unwrap(div);
      continue;
    }

    const paragraph = doc.createElement('p');
    while (div.firstChild) paragraph.appendChild(div.firstChild);
    div.replaceWith(paragraph);
  }

  // Last, and the only line here that is a security boundary.
  return sanitizeWikiHtml(body.innerHTML).trim();
}
