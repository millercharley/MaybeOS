/**
 * Who is blocked by which article, and when (PRD §6.2).
 *
 * Pure, because the grace period is where this gets subtle and where being
 * wrong is expensive in both directions: gate somebody too early and a member
 * who has done nothing wrong cannot post; gate too late and a co-op believes
 * everyone has agreed to something they have not read.
 *
 * The rule in one sentence: **everybody gets the grace period, counted from
 * whichever came later — the day they joined, or the day the requirement
 * appeared.**
 *
 * It used to be grace only for those who predated the requirement, on the
 * reasoning that somebody joining into an established co-op is joining its
 * rules as they stand. That reads well and worked badly. Charley: "make this
 * really easy for them by just reminding them to review these documents
 * within 30 days instead of forcing them out of creating the event or booking
 * their room."
 *
 * A new member's first act is usually the one that matters most — booking the
 * room they joined to use — and meeting a refusal there is a poor way to
 * begin. The handbook still has to be read; it does not have to be read in
 * the ninety seconds before somebody can do the thing they came for.
 */

export interface RequiredArticle {
  id: string;
  title: string;
  slug: string;
  version: number;
  /**
   * When the *current* version started requiring agreement. A material edit
   * bumps this, so v2 gets its own grace period rather than inheriting a
   * window that closed a year ago.
   */
  requiredSince: Date | null;
}

export interface ReaderState {
  /** When this membership began. */
  memberSince: Date;
  /** Versions this member has already agreed to, by article id. */
  acknowledgedVersions: Map<string, number>;
}

export type ReadingStatus =
  | { status: 'done' }
  | { status: 'in-grace'; until: Date }
  | { status: 'blocking' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Where one member stands on one article.
 *
 * `requiredSince: null` is treated as *not yet requiring anything*, never as
 * "required since the beginning of time". An article whose requirement has no
 * start date is a state we should never write, and defaulting it to blocking
 * would lock a whole co-op out on the strength of a null.
 */
export function readingStatus(
  article: RequiredArticle,
  reader: ReaderState,
  graceDays: number,
  now: Date,
): ReadingStatus {
  if (reader.acknowledgedVersions.get(article.id) === article.version) {
    return { status: 'done' };
  }
  if (article.requiredSince === null) return { status: 'done' };

  /*
    From whichever came later (BEL-07).

    Somebody who joined before the requirement counts from the day it
    appeared; somebody who joined after counts from the day they joined.
    Taking the later of the two is both of those rules at once, and it is the
    only reading that never gives anybody a window that closed before they
    arrived.
  */
  const startsAt = Math.max(reader.memberSince.getTime(), article.requiredSince.getTime());
  const until = new Date(startsAt + graceDays * DAY_MS);
  if (now.getTime() < until.getTime()) return { status: 'in-grace', until };

  return { status: 'blocking' };
}

export interface OutstandingReading {
  /** Articles the member must agree to before they can write anything. */
  blocking: RequiredArticle[];
  /** Articles they owe but are not yet blocked by, for the countdown banner. */
  inGrace: Array<{ article: RequiredArticle; until: Date }>;
}

/**
 * Everything one member still owes, in the order they should be shown.
 *
 * Order is the admin's sort position, so onboarding walks somebody through a
 * co-op's articles in the order the co-op decided rather than in whatever
 * order the database happened to return.
 */
export function outstandingReading(
  articles: RequiredArticle[],
  reader: ReaderState,
  graceDays: number,
  now: Date,
): OutstandingReading {
  const blocking: RequiredArticle[] = [];
  const inGrace: Array<{ article: RequiredArticle; until: Date }> = [];

  for (const article of articles) {
    const state = readingStatus(article, reader, graceDays, now);
    if (state.status === 'blocking') blocking.push(article);
    else if (state.status === 'in-grace') inGrace.push({ article, until: state.until });
  }

  return { blocking, inGrace };
}

/**
 * The soonest a member loses access, for the in-app countdown.
 *
 * The nearest deadline rather than the furthest: a banner counting down to
 * the last article would let somebody be blocked by the first one while the
 * banner still said they had a week.
 */
export function graceEndsAt(outstanding: OutstandingReading): Date | null {
  if (outstanding.inGrace.length === 0) return null;
  return outstanding.inGrace.reduce(
    (soonest, entry) => (entry.until < soonest ? entry.until : soonest),
    outstanding.inGrace[0].until,
  );
}
