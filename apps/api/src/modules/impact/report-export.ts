/**
 * The report as a file somebody can attach to an email (IMP-26).
 *
 * **HTML, not PDF, and that is a decision rather than a shortcut.** Three
 * things pushed it here:
 *
 * 1. *The bundle.* This API ships as one Netlify Function against a 250 MB
 *    limit, and `netlify.toml` records the deploy that already failed by
 *    exceeding it. A headless browser is out of the question, and the PDF
 *    libraries that fit cannot render arbitrary rich-text HTML — using one
 *    would mean writing an HTML layout engine, badly, for the one document a
 *    co-op shows a funder.
 * 2. *Drift.* This renders the same frozen blocks the public page renders. A
 *    second rendering path is a second thing that can disagree with the
 *    number a funder was cited, which is the exact failure IMP-22 froze the
 *    figures to prevent.
 * 3. *What it is for.* A co-op needs a file to attach or upload. This opens
 *    in any browser and prints to a clean PDF in two keystrokes, because it
 *    carries its own print stylesheet.
 *
 * What would change it: a funder rejecting a browser-printed page. Nobody has
 * said so, and building for that guess would cost the bundle.
 *
 * Self-contained on purpose — no stylesheet link, no font URL, no image host.
 * A file that needs the network to render is a file that stops rendering the
 * day it is opened somewhere else.
 */

export interface ExportableBlock {
  kind: string;
  heading: string | null;
  body: string | null;
}

export interface ExportableReport {
  title: string;
  periodStart: Date;
  periodEnd: Date;
  publishedAt: Date | null;
  generatedAt: Date;
  blocks: ExportableBlock[];
}

export interface ExportableOrg {
  name: string;
  mission: string | null;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** UTC, for the reason the period label is: a report must not shift a month. */
const monthYear = (d: Date) =>
  d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * A filename somebody can find again in a downloads folder six months later.
 *
 * The co-op and the year, not a slug and a uuid.
 */
export function exportFilename(org: ExportableOrg, report: ExportableReport): string {
  const stem = `${org.name} ${report.periodEnd.getUTCFullYear()} impact report`
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${stem}.html`;
}

/**
 * Blocks are stored as plain text with blank lines between paragraphs, so
 * they are escaped and split rather than trusted as markup. A co-op's own
 * words are content, not HTML — and the composer that writes them is a
 * language model, which is exactly the input not to hand a raw innerHTML.
 */
function paragraphs(body: string | null): string {
  if (!body) return '';
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br />')}</p>`)
    .join('\n      ');
}

export function renderReportDocument(org: ExportableOrg, report: ExportableReport): string {
  const period = `${monthYear(report.periodStart)} – ${monthYear(report.periodEnd)}`;
  // A draft must not print a publication date it does not have. Exporting
  // before publishing is a legitimate thing to do — that is half of "charge
  // to publish or export" — and the file has to say which it is, because a
  // funder reading "Published" is reading a claim about the co-op having
  // stood behind this.
  const published = report.publishedAt !== null;
  const dated = (report.publishedAt ?? report.generatedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const sections = report.blocks
    .map((block) => {
      // Provenance is set apart rather than run on as another section: it is
      // the part that says how the figures were collected and what was
      // suppressed, and a funder should be able to find it without reading
      // to the end.
      const isProvenance = block.kind === 'provenance';
      return `    <section class="${isProvenance ? 'provenance' : 'block'}">
      ${block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : ''}
      ${paragraphs(block.body)}
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(report.title)}</title>
<style>
  /* Self-contained: no linked stylesheet, no web font, no remote image. A
     file that needs the network is a file that stops rendering the day it is
     opened somewhere else. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 3rem 1.5rem 5rem;
    font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    font-size: 17px;
    line-height: 1.65;
    color: #1a1a1a;
    background: #fff;
  }
  main { max-width: 38rem; margin: 0 auto; }
  header { border-bottom: 2px solid #1a1a1a; padding-bottom: 1.5rem; margin-bottom: 2.5rem; }
  .org { font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: #555; margin: 0 0 0.75rem; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.75rem; }
  .period { margin: 0; color: #555; font-size: 0.95rem; }
  .mission { margin: 1.25rem 0 0; font-style: italic; color: #333; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 0.75rem; }
  p { margin: 0 0 1rem; }
  .provenance {
    margin-top: 3.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid #ccc;
    font-size: 0.9rem;
    color: #444;
  }
  .provenance h2 { font-size: 1rem; }
  footer { margin-top: 3.5rem; font-size: 0.8rem; color: #777; }

  @media print {
    /* Printing is the point: this is what turns the file into the PDF a
       funder actually receives. */
    body { padding: 0; font-size: 11.5pt; }
    main { max-width: none; }
    @page { margin: 20mm; }
    /* A heading stranded at the foot of a page, or a figure split from the
       sentence that qualifies it, is how a report loses an argument. */
    h1, h2 { break-after: avoid-page; }
    section { break-inside: avoid-page; }
    .provenance { break-before: auto; }
  }
</style>
</head>
<body>
<main>
  <header>
    <p class="org">${escapeHtml(org.name)}</p>
    <h1>${escapeHtml(report.title)}</h1>
    <p class="period">${escapeHtml(period)}</p>
    ${org.mission ? `<p class="mission">${escapeHtml(org.mission)}</p>` : ''}
  </header>
${sections}
  <footer>
    <p>${published ? 'Published' : 'Prepared'} ${escapeHtml(dated)}. Made with MaybeOS.</p>
  </footer>
</main>
</body>
</html>
`;
}
