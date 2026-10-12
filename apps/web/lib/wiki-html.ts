import { FilterXSS } from 'xss';

/** Everything a wiki page is made of. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
] as const;

/**
 * The same attributes on every tag.
 *
 * DOMPurify's `ALLOWED_ATTR` was global, so `<td title="…">` was allowed and
 * stored bodies may carry one. `xss` is per-tag, and narrowing a boundary
 * quietly is as much a change as widening it — so the previous set is kept
 * whole rather than tightened on the way past.
 */
const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'target', 'rel'];

/** http(s), mailto, and the relative links a wiki page uses for another page. */
const SAFE_URI = /^(?:https?:|mailto:|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

const filter = new FilterXSS({
  whiteList: Object.fromEntries(ALLOWED_TAGS.map((tag) => [tag, ALLOWED_ATTR])),
  /*
    Drop what a disallowed tag contained, rather than escaping it onto the
    page. `<script>steal()</script>` otherwise renders as the visible words
    `steal()` — harmless, and confusing enough that the existing test asks
    for it to be gone.
  */
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'textarea'],
  safeAttrValue(tag, name, value) {
    // Only `href` and `src` carry a URL; the rest are text and `xss` has
    // already escaped them.
    if ((name === 'href' || name === 'src') && !SAFE_URI.test(value.trim())) return '';
    return value;
  },
});

/**
 * Wiki page bodies are HTML, and this is the only thing allowed to render them.
 *
 * The bodies come from `CollectionPage.body`, which is authored through an
 * ADMIN-only route — so the trust boundary is "a co-op's own admins". That was
 * a narrow boundary while the wiki was visible only to admins: the same people
 * who could write the HTML were the only ones who could run it.
 *
 * CMN-06 opened the wiki to every member, which widens it considerably. And
 * since SCL-02 shipped self-serve signup, becoming an admin somewhere takes a
 * registration form — so "admin-authored" is no longer a synonym for
 * "trusted". An unsanitised page body would run in every member's browser with
 * their session in scope.
 *
 * Sanitising rather than escaping, because the content genuinely is HTML and
 * escaping it shows people `<p>` tags. Sanitising rather than hand-rolling a
 * tag stripper, because hand-rolled sanitisers are reliably wrong.
 *
 * **`xss`, not DOMPurify (OPS-35).** DOMPurify needs a DOM, which in Node
 * meant `isomorphic-dompurify` pulling in jsdom — and jsdom never loaded
 * inside the function. Bundled, it lost the stylesheet it reads at startup;
 * marked external, it hit an ESM-only dependency being `require()`d from
 * CommonJS. Either way it threw on every server render of a page holding rich
 * text, 1,988 times in five weeks.
 *
 * So the test this library had to pass was not "is it good" but "can it load":
 * `xss`, `cssfilter` and `commander@4` are all CommonJS, with no ESM anywhere
 * in the tree. `sanitize-html` was tried first and rejected for exactly this —
 * its parser ships ESM only, and it loads under Node 24 solely because
 * `require(ESM)` happens to be supported, which is the same thin ice.
 *
 * It parses HTML itself and touches no DOM, so it also runs identically in
 * Node and in the browser. That removes a risk nobody had noticed: DOMPurify
 * against jsdom and DOMPurify against a real browser DOM are not guaranteed to
 * agree, and this text is rendered in both halves of the same page.
 */
export function sanitizeWikiHtml(html: string): string {
  return filter.process(html);
}
