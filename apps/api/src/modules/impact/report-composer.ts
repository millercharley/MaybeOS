/**
 * What the model is shown, and what it is asked for (IMP-23 phase 2).
 *
 * Kept pure and kept here so the two questions a reader will actually have —
 * *what leaves MaybeOS* and *what stops it inventing things* — are answerable
 * by reading one file rather than by trusting a service.
 *
 * **The model never produces a number.** The figures were computed by IMP-22,
 * frozen into each block's `data` at generation, and are already published in
 * the free report. What the model does is write the prose around them. §8
 * requires every claim to trace to a query and G5 requires every figure to
 * trace to a response count and a window; a model that could originate a
 * figure would break both, quietly, in the one document a co-op hands to
 * somebody with money.
 *
 * **What is sent** (IMP-25): the co-op's name and mission, its goals, the
 * frozen figures with their counts, the spend summary, and the period. All of
 * it has already passed n≥5 suppression and all of it is already public in
 * the free report — nothing leaves that a stranger with the report link
 * cannot already read.
 *
 * **What is never sent**: individual responses, names, email addresses,
 * demographics, suppressed cells, and open text. §10 treats open text as
 * identifiable. The starter instrument has none today, which is why this rule
 * is written down before a free-text question exists rather than after.
 */

/**
 * The blocks a model may rewrite.
 *
 * `provenance` is deliberately absent. It is the block that explains how the
 * figures were collected and what was suppressed — the report's honesty
 * guarantee — and a model rewriting it would be a model rewriting the promise
 * it is being checked against.
 */
export const COMPOSABLE_KINDS = new Set(['intro', 'goal', 'spend', 'synthesis', 'limitations']);

export interface SourceBlock {
  id: string;
  kind: string;
  heading: string | null;
  /** What IMP-22 wrote. The floor: the composition has to beat this or lose. */
  generatedBody: string | null;
  /** The frozen figures. The only numbers that may appear in the output. */
  data: unknown;
}

export interface FactSheet {
  org: { name: string; mission: string | null };
  period: { start: string; end: string; label: string };
  blocks: Array<{
    id: string;
    kind: string;
    heading: string | null;
    facts: unknown;
    deterministicDraft: string;
  }>;
}

/**
 * The years a report may legitimately name, for the number check.
 *
 * Read in UTC for the same reason the label is: a year that appears in the
 * prose and not in this list is rejected as invented.
 */
export function periodYears(periodStart: Date, periodEnd: Date): number[] {
  return [...new Set([periodStart.getUTCFullYear(), periodEnd.getUTCFullYear()])];
}

export function buildFactSheet(input: {
  org: { name: string; mission: string | null };
  periodStart: Date;
  periodEnd: Date;
  blocks: SourceBlock[];
}): FactSheet {
  // UTC, explicitly. Periods are stored as UTC midnights, and formatting them
  // in the server's local zone turns 2026-01-01 into “December 2025” anywhere
  // west of Greenwich — which then makes 2025 a year the prose may mention and
  // the validator has never heard of.
  const label = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    org: input.org,
    period: {
      start: input.periodStart.toISOString().slice(0, 10),
      end: input.periodEnd.toISOString().slice(0, 10),
      label: `${label(input.periodStart)} – ${label(input.periodEnd)}`,
    },
    blocks: input.blocks
      .filter((b) => COMPOSABLE_KINDS.has(b.kind))
      .map((b) => ({
        id: b.id,
        kind: b.kind,
        heading: b.heading,
        facts: b.data ?? null,
        deterministicDraft: b.generatedBody ?? '',
      })),
  };
}

/**
 * The rules, written where the model reads them and mirrored by the checks in
 * `report-validation.ts`.
 *
 * Stated twice on purpose. Asking is how you get a good report; checking is
 * how you get a true one, and a rule that is only asked for is a rule that
 * holds until the day it doesn't.
 */
export const COMPOSER_SYSTEM_PROMPT = `You are writing a co-operative's annual impact report. It will be read by funders, by a board, and by the co-op's own members.

You are given figures that have already been computed and verified. Your job is the prose around them, and nothing else.

Absolute rules. Each one is checked automatically after you write, and a violation means your whole draft is discarded:

1. NEVER write a number that is not in the facts you were given. Not a total you worked out, not a percentage you derived, not a rounded version of something. If you want to say how many people answered, use the exact figure supplied. The scale points 1-5 and the word "100" in "100%" are the only exceptions.

2. NEVER claim cause. The data is what members said, not why. Do not write that anything caused, drove, led to, resulted in, or was because of anything else. "Members rated belonging 3.8 out of 5" is sayable. "Our programmes improved belonging" is not, and never will be from this data.

3. NEVER invent a quotation. No member said anything to you. There are no quotes in your source material, so any sentence in quotation marks is fabricated.

4. NEVER characterise a group of people. You have no demographic data and you must not write as if you did.

5. Do not describe a figure as good, strong, encouraging, or disappointing. State what was measured, out of how many people, and let the reader judge. A co-op that tells a funder its numbers are strong has been let down by its tools.

What good writing looks like here:

- Plain sentences a member would recognise as being about their co-op.
- The mission and the goals in the co-op's own words, not paraphrased into charity language.
- Honest about what is thin. A figure from nine people is a figure from nine people.
- The "synthesis" block should say what the year's figures, taken together, suggest the co-op might look at next — as a question the co-op is asking itself, never as a proven finding.
- The "limitations" block must be specific to THIS co-op: which goals had too few answers, which figures rest on small numbers, what the data cannot show. Boilerplate about survey research generally is worthless here.

You will receive a deterministic draft of each block. It is accurate but flat. You may keep any sentence of it. Write better prose carrying exactly the same claims.

Return one body per block id you were given. Plain text, no markdown headings — the heading is already set.`;

export function composerUserMessage(facts: FactSheet): string {
  return [
    `Co-operative: ${facts.org.name}`,
    facts.org.mission ? `Its mission, in its own words: ${facts.org.mission}` : 'It has not written a mission statement.',
    `Reporting period: ${facts.period.label} (${facts.period.start} to ${facts.period.end})`,
    '',
    'Blocks to write, with the verified facts behind each one:',
    '',
    JSON.stringify(facts.blocks, null, 2),
  ].join('\n');
}

/**
 * The output shape. `id` is echoed back so a body cannot be silently attached
 * to the wrong section — a paragraph about spending under a goal's heading
 * would be a lie assembled out of two true halves.
 */
export const COMPOSER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['id', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['blocks'],
  additionalProperties: false,
} as const;
