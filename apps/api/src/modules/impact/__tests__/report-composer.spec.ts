import {
  COMPOSABLE_KINDS,
  buildFactSheet,
  composerUserMessage,
} from '../report-composer';

/**
 * What leaves MaybeOS when a report is written (IMP-23 phase 2, IMP-25).
 *
 * The one question a co-op will actually ask about this feature, and it
 * deserves an answer that is checked rather than promised. Everything sent is
 * already public in the free report; nothing sent is about an individual.
 */
describe('the fact sheet sent to the model', () => {
  const report = {
    org: { name: 'Sunrise', mission: 'A city where nobody is alone' },
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-12-31'),
    blocks: [
      { id: 'b-intro', kind: 'intro', heading: 'About this report', generatedBody: 'Flat but true.', data: { period: '2026', members: 84 } },
      { id: 'b-goal', kind: 'goal', heading: 'Belonging', generatedBody: 'A sentence.', data: { figures: [{ label: 'Belonging', average: 3.8, respondents: 42 }] } },
      { id: 'b-prov', kind: 'provenance', heading: 'Where these figures come from', generatedBody: 'The honesty guarantee.', data: { suppressionThreshold: 5 } },
    ],
  };

  it('never sends the provenance block', () => {
    // It is the block explaining how figures were collected and what was
    // suppressed. A model rewriting it would be rewriting the promise it is
    // being checked against.
    expect(COMPOSABLE_KINDS.has('provenance')).toBe(false);

    const facts = buildFactSheet(report);
    expect(facts.blocks.map((b) => b.id)).toEqual(['b-intro', 'b-goal']);
  });

  it('carries each block’s frozen figures, which are the only numbers allowed', () => {
    const facts = buildFactSheet(report);
    const goal = facts.blocks.find((b) => b.id === 'b-goal')!;
    expect(goal.facts).toEqual({ figures: [{ label: 'Belonging', average: 3.8, respondents: 42 }] });
  });

  it('carries the deterministic draft, which the composition has to beat', () => {
    const facts = buildFactSheet(report);
    expect(facts.blocks[0].deterministicDraft).toBe('Flat but true.');
  });

  it('sends the mission in the co-op’s own words', () => {
    const message = composerUserMessage(buildFactSheet(report));
    expect(message).toContain('A city where nobody is alone');
  });

  it('says plainly when a co-op has written no mission', () => {
    const message = composerUserMessage(
      buildFactSheet({ ...report, org: { name: 'Sunrise', mission: null } }),
    );
    expect(message).toContain('has not written a mission statement');
  });

  describe('nothing about an individual leaves', () => {
    // The fact sheet is built only from block `data`, which IMP-22 freezes
    // from suppressed aggregates — so this is a structural property, not a
    // filter. The test exists so that a future change which starts passing
    // whole Prisma rows in fails here rather than in production.
    const withPii = {
      ...report,
      blocks: [
        ...report.blocks,
        {
          id: 'b-rogue',
          kind: 'goal',
          heading: 'Rogue',
          generatedBody: 'x',
          data: {
            figures: [{ label: 'Belonging', average: 4.1, respondents: 12 }],
            respondentEmails: ['ada@example.org'],
            respondentNames: ['Ada Lovelace'],
          },
        },
      ],
    };

    it('is a contract the fact sheet cannot keep on its own', () => {
      // Stated honestly: `buildFactSheet` passes block data through, so if
      // PII ever reaches a block it reaches the model. The guarantee lives in
      // what IMP-22 writes into `data`, and this test pins that the two are
      // linked rather than pretending the composer sanitises.
      const message = composerUserMessage(buildFactSheet(withPii));
      expect(message).toContain('ada@example.org');
    });

    it('and the real report’s blocks carry no such field', () => {
      const message = composerUserMessage(buildFactSheet(report));
      expect(message).not.toMatch(/@/);
      expect(message).not.toMatch(/email/i);
      expect(message).not.toMatch(/userId|memberId|respondentId/);
    });
  });
});
