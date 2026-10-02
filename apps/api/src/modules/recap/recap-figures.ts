/**
 * What a month added up to (RCP-01).
 *
 * The shape is here, apart from the queries, because the hard part of this
 * feature is not fetching numbers — it is being honest about which numbers
 * MaybeOS actually has. Three of the figures Charley asked for cannot be
 * known from the database, and each one is handled explicitly rather than
 * quietly approximated:
 *
 *   - **Members who left.** A departed membership is deleted outright
 *     (`member.service.ts`), so MaybeOS has no record of departures and
 *     cannot state net growth. The recap reports people who *joined*, and
 *     says that is what it is reporting.
 *
 *   - **How many people came.** There are two honest answers and they
 *     measure different things: a check-in is somebody who was there, an
 *     RSVP is somebody who meant to be. Check-ins only exist where a human
 *     worked the door, so summing them alone silently undercounts a co-op
 *     that does not scan. Both travel together, each labelled, the way
 *     `hostSummary` already does per event — "a door nobody scanned is not
 *     an event nobody came to".
 *
 *   - **Total revenue.** MaybeOS sees dues, tickets and room hire. It does
 *     not see cash at the door, grants, donations or anything sold off
 *     platform. The figure is named for what it is — money taken through
 *     MaybeOS — rather than presented as the co-op's income.
 *
 * Every figure is frozen onto the recap row at generation and never
 * recomputed, the bargain `ImpactReport` makes: a recap that reads
 * differently in March from the copy in a member's inbox is worth nothing.
 */

export interface MoneyFigure {
  duesCents: number;
  ticketsCents: number;
  roomsCents: number;
  totalCents: number;
}

export interface RecapFigures {
  /** The month, as the co-op's own calendar saw it. */
  monthLabel: string;
  periodStart: string;
  periodEnd: string;

  members: {
    /** Everyone who counts as a member now — guests excluded, as Plus bills. */
    total: number;
    /** People who joined during the month. Joins, not net change. */
    joined: number;
    /**
     * People who arrived in a bulk import during the month, counted apart.
     *
     * A co-op moving in from another system imports its whole roster, and a
     * membership with no join date in the spreadsheet takes today's. Counted
     * as joiners, MaybeItsFate's first recap would have told 364 people that
     * 364 people joined last month — false, and false in the most
     * embarrassing possible direction, to the whole community at once.
     */
    imported: number;
  };

  events: {
    /** Published, uncancelled, happening inside the month. */
    hosted: number;
    /** People recorded at the door. Zero where nobody worked one. */
    checkedIn: number;
    /** How many of the month's events had any check-in at all. */
    eventsWithDoor: number;
    /** Confirmed RSVPs plus the guests they said they were bringing. */
    expected: number;
  };

  money: {
    month: MoneyFigure;
    /** The calendar year to the end of the month, in the co-op's timezone. */
    year: MoneyFigure;
    /** Whether dues figures cover the whole period or start mid-way. */
    duesRecordedSince: string | null;
  };

  service: {
    hours: number;
    members: number;
    /** Only where the co-op set its own hourly rate (D-032). Never supplied. */
    valueCents: number | null;
  } | null;

  /**
   * Impact, where the co-op measures it. All-time rather than monthly, and
   * labelled as such: a single month's answers almost never clear the
   * five-person suppression floor, and a figure that disappears in a quiet
   * month would read as a collapse rather than as too few answers.
   */
  impact: {
    category: string;
    average: number;
    respondents: number;
  }[];
}

/** `2026-09` → "September 2026", for a subject line and a heading. */
export function monthLabel(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function money(parts: Omit<MoneyFigure, 'totalCents'>): MoneyFigure {
  return {
    ...parts,
    totalCents: parts.duesCents + parts.ticketsCents + parts.roomsCents,
  };
}

/**
 * Whether there is enough here to be worth sending.
 *
 * A co-op that did nothing in a month should not receive a letter saying so
 * in six zeroes. Nothing happened is a fine month for a small co-op, and the
 * recap is supposed to make membership feel worthwhile — an empty one does
 * the opposite, which is a worse outcome than no email.
 */
/**
 * Memberships that arrived together are an import, not a month of joining.
 *
 * The signal is the clock: a person joining fills in a form, and two people
 * doing that in the same minute is a coincidence. Twenty-five rows sharing a
 * minute is a spreadsheet. MaybeOS cannot tell a defaulted join date from a
 * real one — the importer only sets `memberSince` when the export knew it —
 * so this reads the shape of the arrival instead.
 *
 * It is a judgement, so it is applied in only one direction: a bulk arrival
 * is reported separately rather than silently dropped, and an organiser can
 * see both numbers.
 */
export const BULK_ARRIVAL = 25;

export function splitArrivals(
  createdAt: readonly Date[],
  threshold: number = BULK_ARRIVAL,
): { joined: number; imported: number } {
  const perMinute = new Map<number, number>();
  for (const at of createdAt) {
    const minute = Math.floor(at.getTime() / 60_000);
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1);
  }

  let imported = 0;
  for (const count of perMinute.values()) {
    if (count >= threshold) imported += count;
  }

  return { joined: createdAt.length - imported, imported };
}

export function worthSending(figures: RecapFigures): boolean {
  return (
    figures.members.joined > 0 ||
    figures.events.hosted > 0 ||
    figures.money.month.totalCents > 0 ||
    (figures.service?.hours ?? 0) > 0
  );
}
