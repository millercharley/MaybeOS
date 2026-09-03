import type {
  DutyOccurrence,
  Recurrence,
  ServiceStanding,
} from '@/lib/api';

/**
 * How the rota reads on screen (SRV-01).
 *
 * Pure, and separate from the pages, because most of the judgement in this
 * feature is in the wording: whether a turn is *covered* or *needs one more*,
 * whether "4h" or "240 minutes", and whether somebody is behind or simply has
 * a month still to run. Getting that wrong is how a rota reads as nagging.
 */

/**
 * "45m", "1h", "1h 30m".
 *
 * Hours once there is an hour, because a co-op says "two hours on Saturday"
 * and never "a hundred and twenty minutes".
 */
export function formatMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "Tue, Sep 8". Dates are already local, so they format in UTC. */
export function shortDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** "8:00 AM" for an instant, in the co-op's timezone. */
export function timeOf(occursAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(occursAt));
}

/** "Every Tuesday", "Monthly", "One-off". */
export function recurrenceLabel(recurrence: Recurrence, firstDate?: string): string {
  if (recurrence === 'NONE') return 'One-off';
  if (recurrence === 'DAILY') return 'Every day';
  if (recurrence === 'MONTHLY') return 'Monthly';

  const every = recurrence === 'BIWEEKLY' ? 'Every other' : 'Every';
  if (!firstDate) return recurrence === 'BIWEEKLY' ? 'Every other week' : 'Weekly';

  const [year, month, day] = firstDate.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));

  return `${every} ${weekday}`;
}

/**
 * What to say about a turn's coverage, from this member's point of view.
 *
 * "Covered" rather than "full", and "needs one more" rather than "1/2": a
 * fraction is a status report, and the member reading it is deciding whether
 * to volunteer.
 */
export function coverage(
  occurrence: DutyOccurrence,
  myUserId?: string | null,
): { label: string; tone: 'mine' | 'open' | 'covered' | 'pending' } {
  const mine = occurrence.claims.find((c) => c.userId === myUserId);

  // Done comes first: a turn already served said "You're on this", which reads
  // as something still owed and is the one status a member might act on twice.
  if (mine?.status === 'DONE') return { label: 'Done', tone: 'mine' };
  if (mine?.status === 'CLAIMED') return { label: 'Waiting on an organiser', tone: 'pending' };
  if (mine) return { label: "You're on this", tone: 'mine' };

  if (occurrence.remaining <= 0) {
    const names = occurrence.claims
      .map((c) => c.name?.split(' ')[0])
      .filter(Boolean);
    return {
      label: names.length ? `Covered by ${listNames(names as string[])}` : 'Covered',
      tone: 'covered',
    };
  }

  if (occurrence.capacity === 1) return { label: 'Nobody yet', tone: 'open' };
  return {
    label: `Needs ${occurrence.remaining} more`,
    tone: 'open',
  };
}

/** "Maya", "Maya and Alex", "Maya, Alex and Sam". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Occurrences grouped by their local date, in order. */
export function byDate(
  occurrences: DutyOccurrence[],
): { date: string; occurrences: DutyOccurrence[] }[] {
  const groups = new Map<string, DutyOccurrence[]>();

  for (const occurrence of occurrences) {
    const list = groups.get(occurrence.date) ?? [];
    list.push(occurrence);
    groups.set(occurrence.date, list);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, occurrences: list }));
}

/** "this week", "this month", "this year". */
export function periodLabel(standing: ServiceStanding): string {
  switch (standing.period) {
    case 'WEEK':
      return 'this week';
    case 'MONTH':
      return 'this month';
    case 'YEAR':
      return 'this year';
  }
}

/**
 * How a member is doing, in a sentence.
 *
 * Deliberately not a percentage and never the word "behind" on its own: a
 * member with three weeks of the month left is not behind, they simply have
 * not finished. The only time this says somebody is short is when there is
 * genuinely nothing left of the window — which the caller decides, since only
 * it knows today's date.
 */
export function standingSentence(standing: ServiceStanding): string {
  if (standing.expectedMinutes === null) {
    return `${formatMinutes(standing.servedMinutes)} served ${periodLabel(standing)}.`;
  }

  const done = formatMinutes(standing.servedMinutes);
  const asked = formatMinutes(standing.expectedMinutes);

  if (standing.shortfallMinutes === 0) {
    return `${done} of ${asked} ${periodLabel(standing)} — you're all set.`;
  }

  const left = formatMinutes(standing.shortfallMinutes ?? 0);
  const prorated = standing.prorated
    ? ' Your first window is scaled from the day you joined.'
    : '';

  return `${done} of ${asked} ${periodLabel(standing)}. ${left} to go.${prorated}`;
}
