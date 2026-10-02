import { RecapFigures } from './recap-figures';

/**
 * Asking Claude for the paragraph at the top of a recap (RCP-01).
 *
 * The rules are the same ones the impact report composer works under
 * (IMP-23), for the same reason: this goes out over the co-op's name to its
 * own members, and a sentence that overstates what a month was costs the
 * co-op more than a dull one ever would.
 *
 * **Every figure it may use is handed to it.** The prompt carries the frozen
 * figures and forbids any number that is not among them — no growth rates, no
 * percentages, no comparisons with months it has not been given. A composed
 * line that invents "up 12% on August" is indistinguishable from a true one
 * to the member reading it, and MaybeOS has no way to check it afterwards.
 */

export const RECAP_SYSTEM_PROMPT = `You write one short paragraph for a community co-op's monthly email to its members.

The co-op is member-run. The reader pays dues and wants to know what the month amounted to.

Rules, all of them absolute:
- Use ONLY the figures given to you. Never state a number that is not in them.
- Never compute a rate, percentage, average or comparison with another month. You have not been given other months.
- Never describe a figure as good, bad, up or down. You cannot know.
- Never invent an event, a person, a story or a quote.
- Do not thank the reader for their membership, do not ask for anything, and do not use exclamation marks.
- Two to four sentences. Plain words. Write like a neighbour, not a newsletter.
- If the figures are thin, write a shorter paragraph rather than padding it.`;

export const RECAP_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    paragraph: {
      type: 'string',
      description: 'Two to four sentences about the month, using only the figures given.',
    },
  },
  required: ['paragraph'],
  additionalProperties: false,
} as const;

/**
 * The figures as the model sees them: a flat list of labelled numbers, and
 * nothing else about the co-op.
 *
 * Deliberately not the whole `RecapFigures` object. A model handed a nested
 * structure with nulls and ISO timestamps will reach for them, and `null`
 * dressed as a figure is how "the co-op raised $0 this month" gets written
 * about a co-op that simply does not show money.
 */
export function recapFacts(
  figures: RecapFigures,
  showMoney: boolean,
): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: 'month', value: figures.monthLabel },
    { label: 'members now', value: String(figures.members.total) },
    { label: 'people who joined this month', value: String(figures.members.joined) },
    { label: 'events held', value: String(figures.events.hosted) },
  ];

  if (figures.events.checkedIn > 0) {
    facts.push({
      label: 'people checked in at the door',
      value: `${figures.events.checkedIn} across ${figures.events.eventsWithDoor} of those events`,
    });
  } else if (figures.events.expected > 0) {
    facts.push({
      label: 'people who said they were coming',
      value: String(figures.events.expected),
    });
  }

  if (figures.service) {
    facts.push({
      label: 'hours members served',
      value: `${figures.service.hours} hours by ${figures.service.members} people`,
    });
  }

  if (showMoney && figures.money.month.totalCents > 0) {
    facts.push({
      label: 'money taken through MaybeOS this month',
      value: dollars(figures.money.month.totalCents),
    });
  }

  for (const measure of figures.impact) {
    facts.push({
      label: `${measure.category} score out of 5`,
      value: `${measure.average} from ${measure.respondents} members`,
    });
  }

  return facts;
}

export function recapUserMessage(facts: { label: string; value: string }[]): string {
  return [
    'Here are the only figures you may use:',
    '',
    ...facts.map((fact) => `- ${fact.label}: ${fact.value}`),
    '',
    'Write the paragraph.',
  ].join('\n');
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Whether a composed paragraph is safe to send.
 *
 * Checks the one failure that matters: a number the model was not given.
 * Every figure handed over is stringified and allowed; any other run of
 * digits in the paragraph means it made something up, and the recap falls
 * back to no paragraph at all rather than to a plausible invention.
 *
 * Years are allowed through — a date is not a claim about the co-op.
 */
export function paragraphIsSupported(
  paragraph: string,
  facts: { label: string; value: string }[],
): boolean {
  const allowed = new Set<string>();
  for (const fact of facts) {
    for (const number of fact.value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      allowed.add(number[0].replace(/,/g, ''));
    }
  }

  for (const found of paragraph.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const bare = found[0].replace(/,/g, '');
    if (allowed.has(bare)) continue;
    // A four-digit year in the month label, written on its own.
    if (/^(19|20)\d{2}$/.test(bare)) continue;
    return false;
  }

  return true;
}
