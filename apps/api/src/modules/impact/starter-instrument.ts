import { SurveyQuestionType, Touchpoint } from '@prisma/client';

/**
 * The questions MaybeOS ships with (IMP-18).
 *
 * Approved by Charley on 2026-08-20, and worth stating what it is and is not.
 * D-021 rejected "a single fixed instrument shipped with the product,
 * identical for every co-op" **as the whole of ImpactOS**, because it makes
 * every community measure the same thing. This is not that: it is a shared
 * core that lets collection begin, with goal-specific questions arriving from
 * the measurement plan (IMP-21) and extending it.
 *
 * The reason it cannot wait for that plan is arithmetic rather than
 * impatience. A year-one report is made of answers given in month one, so
 * every month without collection is a month permanently missing from it —
 * the only part of ImpactOS that cannot be recovered later by working faster.
 *
 * **These are plain-language questions, not validated scales.** UCLA-3, the
 * Social Capital Survey and their relatives are licensed instruments with
 * scoring rules, and claiming a co-op's belonging figure "uses UCLA" when it
 * does not would be worse than the honest version. If a co-op ever needs a
 * validated measure for a funder, that is a licensing decision, not a code
 * change.
 *
 * Two per touchpoint, eight in all. At one question per member per 30 days a
 * member meets roughly twelve a year, so each of these is seen once or twice —
 * which is what makes a per-window average mean anything.
 */

export interface StarterQuestion {
  /** Stable across versions and across co-ops — the join key for everything. */
  key: string;
  text: string;
  type: SurveyQuestionType;
  category: string;
  touchpoint: Touchpoint;
  anchorLow: string;
  anchorHigh: string;
  /**
   * False where a high score is bad news. Loneliness and belonging are both
   * 1–5 and point opposite ways; without this a report would read them alike.
   */
  higherIsBetter?: boolean;
  options?: string[];
}

export const STARTER_INSTRUMENT_VERSION = 1;
export const STARTER_SURVEY_TITLE = 'Community wellbeing';

export const STARTER_QUESTIONS: StarterQuestion[] = [
  // ─── At an event that has just finished ───────────────────
  {
    key: 'belonging_event',
    text: 'At today’s event, how much did you feel you belonged?',
    type: 'SCALE',
    category: 'belonging',
    touchpoint: 'POST_EVENT',
    anchorLow: 'Not at all',
    anchorHigh: 'Completely',
  },
  {
    key: 'network_new_faces',
    // NUMBER rather than SCALE: "how many" has an actual answer, and asking
    // somebody to rate it 1–5 throws away the only precise thing they know.
    text: 'How many people did you talk to today who you didn’t know before?',
    type: 'NUMBER',
    category: 'network_size',
    touchpoint: 'POST_EVENT',
    anchorLow: 'None',
    anchorHigh: 'Several',
  },

  // ─── Buying a ticket ──────────────────────────────────────
  {
    key: 'belonging_general',
    text: 'How much do you feel part of this community?',
    type: 'SCALE',
    category: 'belonging',
    touchpoint: 'TICKET_PURCHASE',
    anchorLow: 'Not at all',
    anchorHigh: 'Completely',
  },
  {
    key: 'participation_frequency',
    text: 'In the last month, how often did you take part in something here?',
    type: 'SCALE',
    category: 'participation',
    touchpoint: 'TICKET_PURCHASE',
    anchorLow: 'Never',
    anchorHigh: 'Weekly',
  },

  // ─── Booking a room ───────────────────────────────────────
  {
    key: 'loneliness_recent',
    text: 'In the last two weeks, how often have you felt lonely?',
    type: 'SCALE',
    category: 'loneliness',
    touchpoint: 'BOOKING',
    anchorLow: 'Never',
    anchorHigh: 'Most days',
    // The one inverted question in the set, and the reason the column exists.
    higherIsBetter: false,
  },
  {
    key: 'network_support',
    text: 'How many people here could you ask for a small favour?',
    type: 'NUMBER',
    category: 'network_size',
    touchpoint: 'BOOKING',
    anchorLow: 'None',
    anchorHigh: 'Several',
  },

  // ─── Visiting the Commons ─────────────────────────────────
  {
    key: 'belonging_voice',
    text: 'How much do you feel your voice counts here?',
    type: 'SCALE',
    category: 'belonging',
    touchpoint: 'COMMONS',
    anchorLow: 'Not at all',
    anchorHigh: 'Completely',
  },
  {
    key: 'civic_local',
    text: 'In the last month, did you take part in anything in your wider neighbourhood or town?',
    type: 'SCALE',
    category: 'civic_engagement',
    touchpoint: 'COMMONS',
    anchorLow: 'Not at all',
    anchorHigh: 'Several times',
  },
];

/** The label a co-op's first collection window carries. */
export function windowLabelFor(date: Date): string {
  return `${date.getUTCFullYear()} baseline`;
}
