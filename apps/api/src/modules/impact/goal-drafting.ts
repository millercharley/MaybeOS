import { STARTER_QUESTIONS } from './starter-instrument';

/**
 * Proposing how to measure a goal (IMP-21).
 *
 * **This is not the AI drafter the PRD describes, and should not be mistaken
 * for it.** D-021 has an admin write a mission and goals in plain language and
 * AI draft indicators and questions from them. MaybeOS has no LLM client, no
 * key, and — more to the point — no decision recording which model, what a
 * co-op's mission may be sent to, or what happens when it is unavailable.
 * Sending a co-op's mission statement to a third party is a decision to take
 * deliberately, not one to arrive by `npm install`.
 *
 * So the workflow ships and the drafter is deterministic: goal text is matched
 * against what the starter instrument already measures, and the admin keeps
 * or discards each suggestion. Everything downstream — goals, indicators,
 * approval, figures grouped by goal — is identical either way, because the
 * drafter's only job is to *propose* and a human decides. Swapping this for a
 * model later changes one function and no schema.
 *
 * The honest limitation: this can only ever suggest categories MaybeOS already
 * collects. A co-op whose goal is not covered by the starter instrument gets
 * no suggestion rather than a bad one, which is the right failure and is also
 * exactly what the AI drafter would fix.
 */

const CATEGORY_LABEL: Record<string, string> = {
  belonging: 'How much people feel they belong here',
  loneliness: 'How often people feel lonely',
  network_size: 'How many people someone knows here',
  participation: 'How often people take part',
  civic_engagement: 'Involvement beyond the co-op',
};

/** Words that suggest a category, in the language co-ops actually use. */
const CUES: Record<string, string[]> = {
  belonging: [
    'belong', 'welcome', 'inclusion', 'inclusive', 'home', 'accepted',
    'community', 'together', 'connect', 'connection', 'voice', 'heard',
  ],
  loneliness: ['lonely', 'loneliness', 'isolation', 'isolated', 'alone', 'wellbeing'],
  network_size: [
    'network', 'friend', 'friendship', 'relationship', 'meet', 'know',
    'neighbour', 'neighbor', 'introduce', 'support',
  ],
  participation: [
    'participate', 'participation', 'attend', 'attendance', 'turnout', 'active',
    'engage', 'engagement', 'involve', 'volunteer', 'regular', 'showing up',
  ],
  civic_engagement: [
    'civic', 'city', 'town', 'neighbourhood', 'neighborhood', 'local',
    'vote', 'voting', 'council', 'advocacy', 'campaign', 'wider',
  ],
};

export interface DraftedIndicator {
  category: string;
  label: string;
  /** Which questions already collect this, so an admin sees the actual wording. */
  questions: string[];
  /** Why it was suggested — never presented as a certainty. */
  because: string;
}

/**
 * Indicators worth considering for a goal, best match first.
 *
 * Returns an empty list rather than a guess when nothing matches. A co-op
 * shown a confident but irrelevant indicator will approve it, and a plan
 * approved without being read is worse than a plan with a gap in it.
 */
export function draftIndicatorsFor(goalTitle: string, goalDescription?: string | null): DraftedIndicator[] {
  const text = `${goalTitle} ${goalDescription ?? ''}`.toLowerCase();

  const scored = Object.entries(CUES)
    .map(([category, cues]) => {
      const hits = cues.filter((cue) => text.includes(cue));
      return { category, hits };
    })
    .filter((c) => c.hits.length > 0)
    .sort((a, b) => b.hits.length - a.hits.length);

  return scored.map(({ category, hits }) => ({
    category,
    label: CATEGORY_LABEL[category] ?? category,
    questions: STARTER_QUESTIONS.filter((q) => q.category === category).map((q) => q.text),
    // The matched word, so an admin can see the suggestion is mechanical and
    // judge it rather than defer to it.
    because: `mentions “${hits[0]}”`,
  }));
}

/** Every category MaybeOS can measure, for an admin who wants to choose directly. */
export function allMeasurableCategories(): DraftedIndicator[] {
  return Object.keys(CATEGORY_LABEL).map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    questions: STARTER_QUESTIONS.filter((q) => q.category === category).map((q) => q.text),
    because: 'available in the questions MaybeOS asks',
  }));
}
