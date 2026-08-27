import {
  groundedNumbers,
  numeralsIn,
  validateComposition,
  violationsAsFeedback,
} from '../report-validation';

/**
 * The checks that stand between a model and a grant application (IMP-23
 * phase 2, PRD §8).
 *
 * The prompt asks for these rules and this enforces them, and the reason both
 * exist is that a rule which is only asked for holds until the day it doesn't.
 * The day it doesn't is a funder reading a figure nobody can trace.
 *
 * Every test below is written as the sentence a model might plausibly produce
 * — not as a contrived string — because a check that only catches obvious
 * violations catches nothing that would ever actually happen.
 */
describe('report composition guardrails', () => {
  const facts = {
    figures: [
      { label: 'Belonging', average: 3.8, respondents: 42, answerCount: 51 },
      { label: 'Loneliness', average: 2.1, respondents: 19, answerCount: 22 },
    ],
  };
  const block = (body: string) => [{ id: 'b1', body }];
  const source = [{ id: 'b1', facts }];
  const rules = (body: string) => validateComposition(block(body), source).map((v) => v.rule);

  describe('numbers', () => {
    it('accepts a figure that is in the facts', () => {
      expect(rules('Members rated belonging 3.8 out of 5, from 42 people.')).toEqual([]);
    });

    it('rejects a figure that is not', () => {
      // The dangerous case: plausible, well-formed, and invented.
      expect(rules('Members rated belonging 4.6 out of 5, from 42 people.')).toContain(
        'ungrounded-number',
      );
    });

    it('rejects a total the model worked out for itself', () => {
      // 42 + 19 is arithmetic the model was not asked to do, over two
      // respondent pools that may overlap. The sum is not 61 of anything.
      expect(rules('61 members answered across both questions.')).toContain('ungrounded-number');
    });

    it('accepts a share written as a percentage of a share in the facts', () => {
      const spend = [{ id: 'b1', facts: { totalCents: 250000, attributedShare: 0.62 } }];
      const v = validateComposition(block('62% of what was spent served a stated goal.'), spend);
      expect(v).toEqual([]);
    });

    it('accepts cents written as dollars', () => {
      const spend = [{ id: 'b1', facts: { totalCents: 250000 } }];
      expect(validateComposition(block('It spent $2500.00 over the period.'), spend)).toEqual([]);
    });

    it('allows the scale points, which are the ruler and not a claim', () => {
      // Without this the check would fire on the house phrasing of every
      // single rated question, and a check that always fires gets removed.
      expect(rules('Members rated belonging 3.8 out of 5.')).toEqual([]);
    });

    it('allows a year passed in as a global', () => {
      const v = validateComposition(block('Over 2026, members answered.'), source, [2026]);
      expect(v).toEqual([]);
    });
  });

  describe('causal claims', () => {
    it('accepts a statement of what was measured', () => {
      expect(rules('Members rated how much they feel they belong 3.8 out of 5.')).toEqual([]);
    });

    it.each([
      'Our monthly suppers led to a higher sense of belonging.',
      'Belonging rose as a result of the new programme.',
      'Thanks to the volunteer scheme, members felt less lonely.',
      'We improved belonging this year.',
      'The impact of our work is visible in these figures.',
      'The change was driven by the new space.',
    ])('rejects: %s', (sentence) => {
      expect(rules(sentence)).toContain('causal-claim');
    });

    it('lets a co-op describe its own reasoning', () => {
      // "These figures led us to ask" is the co-op talking about itself, not
      // a claim about cause in the data. Catching it would make the synthesis
      // block unwritable.
      expect(rules('These figures led us to ask what members want next.')).toEqual([]);
    });
  });

  describe('evaluation, which is the reader’s job', () => {
    it.each([
      'This is a strong result for the co-op.',
      'The scores are encouraging.',
      'It has been an excellent year.',
    ])('rejects: %s', (sentence) => {
      expect(rules(sentence)).toContain('evaluative-language');
    });

    it('does not trip on a co-op’s own mission language', () => {
      // A mission saying "a strong community" is the co-op's words quoted
      // back, not MaybeOS grading its figures.
      expect(rules('Its mission is to build a strong community in Peckham.')).toEqual([]);
    });
  });

  describe('groups of people it has no data about', () => {
    it.each([
      'Younger members reported feeling less connected.',
      'Members aged 25 to 34 answered most often.',
      'New members felt more welcome than long-standing ones.',
    ])('rejects: %s', (sentence) => {
      // Demographics are never sent (IMP-25), so any sentence like this is
      // describing something the model does not have.
      expect(rules(sentence).some((r) => r === 'segment-claim' || r === 'ungrounded-number')).toBe(true);
    });
  });

  describe('quotations', () => {
    it('rejects a quoted sentence, because nobody said anything', () => {
      expect(
        rules('One member told us, “I finally feel like I have somewhere to go on a Sunday.”'),
      ).toContain('invented-quote');
    });

    it('allows a short quoted phrase, like a goal’s own title', () => {
      expect(rules('The goal called “Belonging” has a figure this year.')).toEqual([]);
    });
  });

  describe('sections that came back wrong', () => {
    it('catches a blank section', () => {
      expect(rules('   ')).toEqual(['empty']);
    });

    it('catches a section the model skipped', () => {
      expect(validateComposition([], source).map((v) => v.rule)).toEqual(['missing-block']);
    });
  });

  describe('what the retry is told', () => {
    it('names the rule and the offending text, not just that it was wrong', () => {
      const violations = validateComposition(block('Belonging reached 4.9 thanks to our work.'), source);
      const feedback = violationsAsFeedback(violations);

      // "You wrote 4.9, which is not in the figures" is actionable.
      // "That was wrong" is a second coin flip.
      expect(feedback).toContain('4.9');
      expect(feedback).toContain('ungrounded-number');
      expect(feedback).toContain('causal-claim');
    });
  });

  describe('the primitives', () => {
    it('strips thousands separators so 1,250 and 1250 are one number', () => {
      expect(numeralsIn('It spent 1,250 pounds')).toEqual(['1250']);
    });

    it('grounds a number in every honest spelling of it', () => {
      const g = groundedNumbers({ average: 3.75, share: 0.62 });
      expect(g.has('3.8')).toBe(true); // rounded to one place
      expect(g.has('4')).toBe(true); // rounded to none
      expect(g.has('62')).toBe(true); // the share as a percentage
    });
  });
});
