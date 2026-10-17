import { FilterXSS } from 'xss';

/**
 * An admin's own words, made safe to put in somebody's mail client (CMN-21).
 *
 * The Commons composer produces HTML, and an announcement sends that HTML to
 * every member. Until now nothing on this side of the wire sanitised
 * anything: the web app cleans a post on the way *out of the database and
 * onto a page* (OPS-35), and an email never passes through that.
 *
 * The allowlist is deliberately narrower than the web's. A page can afford
 * tables, ids and classes; an email is rendered by thirty clients with thirty
 * opinions, and every tag that is not prose is a way for a message to arrive
 * looking broken. `xss` is the same library the web settled on, chosen there
 * because its dependency tree is CJS all the way down and the Netlify bundle
 * cannot take an ESM-only parser.
 */

/** What an announcement may contain. Prose, lists, links, pictures. */
const ALLOWED: Record<string, string[]> = {
  p: [],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  h1: [],
  h2: [],
  h3: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  hr: [],
  code: [],
  pre: [],
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
};

/**
 * Addresses a mail client may follow.
 *
 * `mailto:` earns its place — an announcement saying "write to the organisers"
 * should be able to link to them. `javascript:` and `data:` do not: the first
 * does nothing in mail and everything in a webmail preview pane, and the
 * second is how an image tag becomes a payload.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const SAFE_SRC = /^https:\/\//i;

const filter = new FilterXSS({
  whiteList: ALLOWED,
  // A tag that is not on the list loses its markup; one whose *content* is
  // machinery loses the content as well.
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
  safeAttrValue(tag, name, value) {
    if (name === 'href') return SAFE_HREF.test(value.trim()) ? value : '';
    // `https` only for pictures, and not out of prudishness: a plain `http`
    // image in an email is a mixed-content warning in half of the clients
    // that show it at all.
    if (name === 'src') return SAFE_SRC.test(value.trim()) ? value : '';
    return value;
  },
});

/** The body, with anything that is not prose taken out. */
export function sanitizeEmailHtml(html: string): string {
  return filter.process(html ?? '');
}
