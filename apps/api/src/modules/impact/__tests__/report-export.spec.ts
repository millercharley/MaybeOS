import { exportFilename, renderReportDocument } from '../report-export';

/**
 * The file a funder receives (IMP-26).
 *
 * The properties worth pinning are not about layout — they are about the file
 * still being true and still rendering when it is opened somewhere MaybeOS
 * has never heard of, six months from now, by somebody deciding whether to
 * give a co-op money.
 */
describe('the exported report', () => {
  const org = { name: 'Sunrise Community Space', mission: 'A city where nobody is alone' };

  const report = {
    title: 'Sunrise: 2026 impact',
    periodStart: new Date('2026-01-01T00:00:00Z'),
    periodEnd: new Date('2026-12-31T00:00:00Z'),
    publishedAt: new Date('2027-01-15T00:00:00Z'),
    generatedAt: new Date('2027-01-10T00:00:00Z'),
    blocks: [
      { kind: 'intro', heading: 'About this report', body: 'One paragraph.\n\nAnd another.' },
      {
        kind: 'goal',
        heading: 'Nobody here is a stranger',
        body: 'Members rated belonging 3.7 out of 5, from 6 people.',
      },
      {
        kind: 'provenance',
        heading: 'Where these figures come from',
        body: 'Nothing is reported unless at least 5 people answered it.',
      },
    ],
  };

  const html = () => renderReportDocument(org, report);

  describe('it renders without the network', () => {
    it('links no stylesheet, font or image', () => {
      // A file that needs the network is a file that stops rendering the day
      // it is opened somewhere else — which is every day, for an attachment.
      const doc = html();
      expect(doc).not.toMatch(/<link\b/i);
      expect(doc).not.toMatch(/<img\b/i);
      expect(doc).not.toMatch(/@import/i);
      expect(doc).not.toMatch(/https?:\/\//);
    });

    it('carries its own print rules, because printing is the point', () => {
      const doc = html();
      expect(doc).toContain('@media print');
      expect(doc).toContain('@page');
      // A heading stranded at the foot of a page, or a figure split from the
      // sentence that qualifies it, is how a report loses an argument.
      expect(doc).toContain('break-after: avoid-page');
      expect(doc).toContain('break-inside: avoid-page');
    });
  });

  describe('it says what the page says', () => {
    it('carries every block, in order', () => {
      const doc = html();
      const positions = report.blocks.map((b) => doc.indexOf(b.heading!));
      expect(positions.every((p) => p > -1)).toBe(true);
      expect([...positions]).toEqual([...positions].sort((a, b) => a - b));
    });

    it('keeps the paragraph breaks a co-op wrote', () => {
      expect(html()).toContain('<p>One paragraph.</p>');
      expect(html()).toContain('<p>And another.</p>');
    });

    it('sets provenance apart rather than running it on', () => {
      // It is the part saying how figures were collected and what was
      // suppressed. A funder should find it without reading to the end.
      expect(html()).toContain('class="provenance"');
    });

    it('names the period in UTC, so a 2026 report is not a 2025 one', () => {
      // The same bug that printed "December 2025 – December 2026" on the
      // cover of a 2026 report anywhere west of Greenwich.
      expect(html()).toContain('January 2026 – December 2026');
    });
  });

  describe('it does not claim a date it does not have', () => {
    it('says Published, with the publication date, once published', () => {
      expect(html()).toContain('Published 15 January 2027');
    });

    it('says Prepared for a draft, because exporting before publishing is allowed', () => {
      // Half of "charge to publish or export" is exporting *instead* of
      // publishing. A funder reading "Published" is reading a claim about the
      // co-op having stood behind this, and a draft has not.
      const doc = renderReportDocument(org, { ...report, publishedAt: null });
      expect(doc).toContain('Prepared 10 January 2027');
      expect(doc).not.toContain('Published');
    });
  });

  describe('it does not execute what a co-op or a model wrote', () => {
    it('escapes a script tag in a block body', () => {
      // The composer is a language model and the bodies are editable. Neither
      // is an input to hand a raw innerHTML.
      const doc = renderReportDocument(org, {
        ...report,
        blocks: [{ kind: 'intro', heading: 'X', body: '<script>alert(1)</script>' }],
      });
      expect(doc).not.toContain('<script>alert(1)</script>');
      expect(doc).toContain('&lt;script&gt;');
    });

    it('escapes a heading and a co-op name too', () => {
      const doc = renderReportDocument(
        { name: '<b>Sunrise</b>', mission: null },
        { ...report, blocks: [{ kind: 'intro', heading: '<i>Hi</i>', body: 'x' }] },
      );
      expect(doc).not.toContain('<b>Sunrise</b>');
      expect(doc).not.toContain('<i>Hi</i>');
    });
  });

  describe('the filename', () => {
    it('is something findable in a downloads folder months later', () => {
      expect(exportFilename(org, report)).toBe('sunrise-community-space-2026-impact-report.html');
    });

    it('takes the year from the period, not from today', () => {
      // A report written in January about last year is normal, and naming it
      // by the writing date would file it under the wrong year.
      expect(exportFilename(org, report)).toContain('2026');
      expect(exportFilename(org, report)).not.toContain('2027');
    });

    it('survives a co-op name full of punctuation', () => {
      const name = { name: "St. Mary's Co-op & Friends!", mission: null };
      const file = exportFilename(name, report);
      expect(file).toMatch(/^[a-z0-9-]+\.html$/);
    });
  });
});
