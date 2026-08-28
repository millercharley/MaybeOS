/**
 * Who is blocked by which article, and when (PRD §6.2).
 *
 * Pure, because the grace period is where this gets subtle and where being
 * wrong is expensive in both directions: gate somebody too early and a member
 * who has done nothing wrong cannot post; gate too late and a co-op believes
 * everyone has agreed to something they have not read.
 *
 * The rule in one sentence: **you get a grace period only if the requirement
 * arrived after you did.** Somebody joining today, into a co-op that
 * published its house rules two years ago, is not owed fourteen days to think
 * about it — the rules are part of what they joined. Somebody who has been a
 * member for two years and is told on a Tuesday that there is now something
 * to agree to, is.
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

  // Joined after the requirement existed: it is part of what they joined, and
  // onboarding walks them through it before they can act.
  const joinedBefore = reader.memberSince.getTime() < article.requiredSince.getTime();
  if (!joinedBefore) return { status: 'blocking' };

  const until = new Date(article.requiredSince.getTime() + graceDays * DAY_MS);
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
