/**
 * A Google Calendar description, as text (CAL-10).
 *
 * Google stores an event's description as HTML, and MaybeOS treats a
 * description as plain text everywhere it is written and most places it is
 * read. So 777 imported events arrived with their markup showing:
 *
 *     <div><p><a href="https://..." target="_blank">Reserve tickets!</a></p>
 *     <p>JG Shadid is an EMMY NOMINATED composer...
 *
 * Converted on the way in rather than rendered on the way out. A description
 * is edited in a textarea by whoever runs the event; handing them a box full
 * of tags to correct a date in is worse than the tags themselves, and
 * rendering arbitrary HTML from a third party into a page every member reads
 * is a different decision again.
 *
 * Links keep their address, because "Reserve tickets!" with the URL thrown
 * away is a sentence about a thing nobody can reach.
 */

const ENTITIES: Record<string, string> = {
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
  ldquo: '“',
  rdquo: '”',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    // `&amp;` last would double-decode `&amp;lt;`; the map handles both in
    // one pass instead.
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole);
}

export function htmlToText(html: string | null | undefined): string | null {
  const source = (html ?? '').trim();
  if (source === '') return null;

  // Nothing that looks like markup: leave it exactly as it is. Most calendars
  // are written by people typing into a box.
  if (!/<[a-z!/][^>]*>/i.test(source)) return decodeEntities(source) || null;

  let text = source
    // Script and style carry content that is not prose at all.
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    // A link keeps its text and its address, which is the point of it.
    .replace(
      /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, label: string) => {
        const words = label.replace(/<[^>]+>/g, '').trim();
        if (!words) return href;
        // An address that is already the label needs saying once.
        return words === href ? href : `${words} (${href})`;
      },
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '');

  text = decodeEntities(text)
    // Collapse the runs the tags left behind, without flattening the
    // paragraphs somebody wrote.
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text === '' ? null : text;
}
