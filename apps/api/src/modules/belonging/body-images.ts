/**
 * Pictures inside a handbook article's own text (BEL-13).
 *
 * Charley: "I need to add an image in-line in this Handbook post."
 *
 * A cover is one picture and a path on the row. A screenshot in MaybeOS's own
 * documentation is a row in its own table, shown after the words. Neither puts
 * a picture *between two paragraphs*, which is what a page explaining where
 * the door reader is actually needs.
 *
 * **The path is what is stored, never the URL.** The attachments bucket is
 * private — the handbook is for members — so the only thing that would work in
 * an `<img src>` is a signed URL, and those expire. Saving one would give an
 * article that looks right for an hour and is broken by morning. So the body
 * keeps `data-path`, the reader is handed a freshly signed `src` each time it
 * is read, and the thing in the database stays true indefinitely.
 *
 * Pure, and regex rather than a DOM, for the same reason `jpeg-size` reads a
 * header by hand: this runs in a serverless function, and a parser is a native
 * dependency for a job that is rewriting one attribute on one tag.
 */

/** Every `<img>` in the body, whole, so a rewrite can replace the tag. */
const IMG_TAG = /<img\b[^>]*>/gi;

/** `data-path="…"` or `data-path='…'`, which is the only form we write. */
const DATA_PATH = /\bdata-path\s*=\s*(["'])(.*?)\1/i;
const ALT = /\balt\s*=\s*(["'])(.*?)\1/i;

/** Escape a value going back into an attribute we are writing. */
function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * The stored paths of every picture in this body.
 *
 * Deduplicated, because the same picture used twice should be signed once —
 * and an article is read far more often than it is written.
 */
export function bodyImagePaths(html: string | null | undefined): string[] {
  if (!html) return [];

  const paths = new Set<string>();
  for (const tag of html.match(IMG_TAG) ?? []) {
    const found = tag.match(DATA_PATH)?.[2]?.trim();
    if (found) paths.add(found);
  }
  return [...paths];
}

/**
 * The same body, with each picture pointing at a URL that will load.
 *
 * An image whose path is missing from `urls` is dropped rather than left
 * pointing nowhere: a broken-image icon in the middle of the house rules
 * looks like the co-op is broken, and an absent picture looks like an absent
 * picture.
 *
 * An `<img>` with no `data-path` is left exactly as it is — somebody may have
 * pasted a picture from elsewhere, and that is theirs, not ours to rewrite.
 */
export function signBodyImages(
  html: string | null | undefined,
  urls: Map<string, string>,
): string {
  if (!html) return '';

  return html.replace(IMG_TAG, (tag) => {
    const path = tag.match(DATA_PATH)?.[2]?.trim();
    if (!path) return tag;

    const url = urls.get(path);
    if (!url) return '';

    const alt = tag.match(ALT)?.[2] ?? '';
    return `<img src="${attr(url)}" data-path="${attr(path)}" alt="${attr(alt)}" />`;
  });
}
