/**
 * What stops a written report from being a plausible-sounding lie (IMP-23
 * phase 2, PRD §8).
 *
 * The prompt asks; this checks. A rule that is only asked for is a rule that
 * holds until the day it doesn't, and the day it doesn't is a grant
 * application containing a figure nobody can trace. Every rule stated to the
 * model in `report-composer.ts` has a check here, and a draft that fails any
 * of them is discarded rather than published — the co-op gets the
 * deterministic report, which is flat and true, instead of prose that is
 * neither.
 */

export interface Violation {
  blockId: string;
  rule:
    | 'ungrounded-number'
    | 'causal-claim'
    | 'invented-quote'
    | 'segment-claim'
    | 'evaluative-language'
    | 'empty'
    | 'missing-block';
  detail: string;
}

/**
 * Scale points and percent.
 *
 * "3.8 out of 5" is the house phrasing for every rated question and the 5 is
 * not a figure about anybody — it is the ruler. Same for "100%" and for zero.
 * Allowing these is the difference between a check that runs and a check that
 * is switched off because it cried wolf.
 */
const SCALE_CONSTANTS = new Set(['0', '1', '2', '3', '4', '5', '100']);

/** Every digit run in the prose, normalised for comparison. */
export function numeralsIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Every rendering of a number that the facts actually support.
 *
 * One figure has several honest spellings — 3.75 may be written 3.8, a share
 * of 0.62 may be written 62%, and 12345 cents is $123.45. Each is generated
 * from the source rather than accepted on sight, so "62" is allowed only
 * because 0.62 was in the data.
 */
export function groundedNumbers(facts: unknown, extra: number[] = []): Set<string> {
  const out = new Set<string>(SCALE_CONSTANTS);

  const add = (n: number) => {
    if (!Number.isFinite(n)) return;
    out.add(String(n));
    out.add(String(Math.round(n)));
    out.add(n.toFixed(1));
    out.add(n.toFixed(2));
    // A share written as a percentage.
    if (n >= 0 && n <= 1) {
      out.add(String(Math.round(n * 100)));
      out.add((n * 100).toFixed(1));
    }
    // Cents written as dollars, with and without the decimal part.
    if (Number.isInteger(n) && Math.abs(n) >= 100) {
      out.add((n / 100).toFixed(2));
      out.add(String(Math.round(n / 100)));
      out.add(String(Math.floor(n / 100)));
    }
  };

  const walk = (v: unknown): void => {
    if (typeof v === 'number') return add(v);
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') return Object.values(v as Record<string, unknown>).forEach(walk);
  };

  walk(facts);
  extra.forEach(add);
  return out;
}

/**
 * Asserted cause, which this data cannot support.
 *
 * Members said how they feel. Nothing here records why, and a co-op telling a
 * funder that its programme raised belonging on the strength of a few
 * micro-questions has been let down by its tools. Matched as phrases rather
 * than single words so "the results led us to ask" is not caught — that is a
 * co-op describing its own reasoning, which is fine and useful.
 */
const CAUSAL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(caused|causing)\b/i, 'caused'],
  [/\bled to\b/i, 'led to'],
  [/\bresulted in\b/i, 'resulted in'],
  [/\bresulting from\b/i, 'resulting from'],
  [/\bbecause of (our|the|these|this|its)\b/i, 'because of'],
  [/\bas a result of\b/i, 'as a result of'],
  [/\bthanks to\b/i, 'thanks to'],
  [/\bdue to (our|the|these|this|its)\b/i, 'due to'],
  [/\b(drove|driven by)\b/i, 'drove'],
  [/\b(we|our\b[^.]{0,40}) (increased|improved|raised|reduced|boosted|lowered)\b/i, 'claimed effect'],
  [/\b(increased|improved|raised|reduced|boosted|lowered) (belonging|loneliness|participation|engagement|wellbeing)\b/i, 'claimed effect'],
  [/\bimpact of\b/i, 'impact of'],
  [/\bcontributed to\b/i, 'contributed to'],
];

/**
 * Evaluation, which is the reader's job.
 *
 * Only matched next to a figure or a measured concept, so a co-op's own
 * mission statement quoted back ("a strong community") does not trip it.
 */
const EVALUATIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(strong|excellent|encouraging|disappointing|poor|impressive|healthy|worrying)\s+(score|result|figure|number|rating|showing)/i, 'evaluated a figure'],
  [/\b(score|result|figure|number|rating)s?\s+(are|is|were|was)\s+(strong|excellent|encouraging|disappointing|poor|impressive|healthy|worrying)/i, 'evaluated a figure'],
  [/\b(a|an)\s+(strong|excellent|encouraging|disappointing|poor|impressive)\s+(year|performance|outcome)/i, 'evaluated the year'],
];

/**
 * Groups of people the report has no data about.
 *
 * Demographics are never sent (IMP-25), so any sentence characterising one is
 * describing something the model does not have — invented, not merely
 * unsupported.
 */
const SEGMENT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(younger|older|female|male|women|men|BIPOC|disabled|queer|trans|white|black|asian|latino|latina|hispanic)\s+(members|respondents|people|participants)\b/i, 'characterised a demographic group'],
  [/\bmembers (aged|under|over)\s*\d/i, 'characterised an age group'],
  [/\b(new|long-standing|founding)\s+members\s+(are|were|felt|feel|reported|rated)\b/i, 'characterised a membership segment'],
];

/** A sentence in quotation marks. Nobody said anything to the model. */
const QUOTE_PATTERN = /["“][^"”]{25,}["”]/;

export interface Composed {
  id: string;
  body: string;
}

/**
 * Check one draft against the facts it was written from.
 *
 * Returns every violation rather than the first, so a retry can be told
 * everything that was wrong instead of playing the same round again.
 */
export function validateComposition(
  composed: Composed[],
  blocks: Array<{ id: string; facts: unknown }>,
  globals: number[] = [],
): Violation[] {
  const violations: Violation[] = [];
  const byId = new Map(composed.map((c) => [c.id, c.body]));

  for (const block of blocks) {
    const body = byId.get(block.id);

    if (body === undefined) {
      violations.push({
        blockId: block.id,
        rule: 'missing-block',
        detail: 'no body was written for this section',
      });
      continue;
    }

    if (body.trim().length === 0) {
      // A blank section is worse than a flat one: the report loses a heading's
      // worth of content and nothing says why.
      violations.push({ blockId: block.id, rule: 'empty', detail: 'the section came back blank' });
      continue;
    }

    const allowed = groundedNumbers(block.facts, globals);
    for (const numeral of numeralsIn(body)) {
      if (!allowed.has(numeral)) {
        violations.push({
          blockId: block.id,
          rule: 'ungrounded-number',
          detail: `“${numeral}” is not in the figures for this section`,
        });
      }
    }

    for (const [pattern, name] of CAUSAL_PATTERNS) {
      if (pattern.test(body)) {
        violations.push({ blockId: block.id, rule: 'causal-claim', detail: name });
      }
    }

    for (const [pattern, name] of EVALUATIVE_PATTERNS) {
      if (pattern.test(body)) {
        violations.push({ blockId: block.id, rule: 'evaluative-language', detail: name });
      }
    }

    for (const [pattern, name] of SEGMENT_PATTERNS) {
      if (pattern.test(body)) {
        violations.push({ blockId: block.id, rule: 'segment-claim', detail: name });
      }
    }

    if (QUOTE_PATTERN.test(body)) {
      violations.push({
        blockId: block.id,
        rule: 'invented-quote',
        detail: 'a quotation, and nobody said anything to the writer',
      });
    }
  }

  return violations;
}

/** What the retry is told, in the model's own terms. */
export function violationsAsFeedback(violations: Violation[]): string {
  const byBlock = new Map<string, Violation[]>();
  for (const v of violations) {
    byBlock.set(v.blockId, [...(byBlock.get(v.blockId) ?? []), v]);
  }

  return [
    'That draft broke rules that are checked automatically. Rewrite every section, fixing these:',
    '',
    ...[...byBlock.entries()].map(([id, vs]) =>
      `Section ${id}:\n${vs.map((v) => `  - ${v.rule}: ${v.detail}`).join('\n')}`,
    ),
    '',
    'Keep the same claims. Remove the offending words rather than arguing for them.',
  ].join('\n');
}
