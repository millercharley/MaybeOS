import { Prisma } from '@prisma/client';

/**
 * What a teaching offering published to the open internet may contain
 * (TCH-01, following SEC-12).
 *
 * Two unauthenticated routes return offerings — the public page and the embed
 * — and the thing they are publishing is **a member**. That is the difference
 * between this file and `event-view.ts`: an event is a co-op advertising its
 * own calendar, and an offering is a person saying "I teach this, come and
 * find me." Everything attached to it points at somebody.
 *
 * So the dangerous columns here are not OAuth tokens, they are the teacher.
 * Named rather than left to a `include`, because `User` carries `email`,
 * `passwordHash`, `magicLinkToken` and `passwordResetToken`, and an `include`
 * on the relation would return the lot. The teacher travels as a **name and a
 * picture and nothing else** — no address, no id, no membership.
 *
 * `interests` is absent entirely and must stay absent. An interest note is a
 * learner writing privately to a teacher — "I am a complete beginner", "money
 * is tight this month" — and the count alone would tell a stranger how
 * popular somebody is. Neither belongs on a marketing page.
 *
 * A select, not a redaction list, for the reason MEM-14 and SEC-11 give: a
 * column added to the model tomorrow is absent from a select and present in a
 * delete-list somebody forgot to update.
 */
export const PUBLIC_OFFERING_SELECT = {
  id: true,
  orgId: true,
  kind: true,
  title: true,
  slug: true,
  summary: true,
  description: true,
  richDescription: true,
  imageUrl: true,
  // The picture's credit travels with the picture (EVT-22). An Unsplash photo
  // with nobody credited is not something their terms allow, and a public
  // page is where a photo is most likely to be seen.
  imageCredit: true,
  imageCreditUrl: true,
  imageFocusY: true,
  visibility: true,
  payment: true,
  priceCents: true,
  priceNote: true,
  currency: true,
  closedAt: true,

  /*
    The teacher, as a person rather than a row.

    `name` because an offering with no teacher on it is an advert for nobody,
    and `avatarUrl` because a face is most of why somebody reads one. Not
    `id`: the public event page already withholds the host's *name*, so an id
    there would be worse than useless — here the name is the point, and the id
    is still a handle on a member that a stranger has no use for.

    Never `email`. A teacher is contacted through the offering, which is the
    whole reason `OfferingInterest` exists: the enquiry reaches them without
    their address reaching the web.
  */
  teacher: { select: { name: true, avatarUrl: true } },

  /*
    The dates, when there are any.

    Narrowed by hand rather than reusing `PUBLIC_EVENT_SELECT`, because that
    one answers a different question. A session listed under its offering
    needs when it is, where it is and what it costs — not its RSVP count, not
    its own description, and not the room's id. A visitor who wants the rest
    follows `url` to the event page, which is already public and already
    tested.

    Filtered to published, uncancelled, publicly-visible sessions at the call
    site: a workshop may have a private rehearsal date on it.
  */
  sessions: {
    select: {
      slug: true,
      title: true,
      startTime: true,
      endTime: true,
      timezone: true,
      priceCents: true,
      currency: true,
      capacity: true,
      maturityLevel: true,
      location: { select: { name: true } },
    },
  },
} satisfies Prisma.OfferingSelect;

/**
 * What a signed-in member sees that the open web does not. Four things.
 *
 * `teacher.id`, so the page can link to their profile in the directory —
 * which is behind the same sign-in, so the id reaches nobody new.
 *
 * `isPublished` and `createdAt`, so a teacher's own list can show them a
 * draft and say when they wrote it.
 *
 * `_count.interests` — how many people have put their hand up. Not on the
 * public select, where it would tell a stranger how in-demand a particular
 * member is. Inside the co-op it is the same kind of fact as an event's RSVP
 * count, which members already see, so it is shown on the same reasoning.
 * **The notes themselves are not here and never will be**: those are fetched
 * by the teacher's own route, which checks `canSeeInterest`.
 */
export const MEMBER_OFFERING_SELECT = {
  ...PUBLIC_OFFERING_SELECT,
  /*
    Every session, in order — including the ones that have been.

    Unlike the public read, which shows only what is still to come: a member
    looking at a workshop they are thinking about wants the next date, and the
    teacher looking at the same screen wants the whole run. The *screen*
    decides which to draw, using `hasEnded` from `lib/event-tabs` so there is
    one definition of past in the product (EVT-49).

    Ordered here rather than in the page, because a list that arrives in
    insertion order and is sorted on the client is a list that flickers.
  */
  sessions: {
    ...PUBLIC_OFFERING_SELECT.sessions,
    orderBy: { startTime: 'asc' as const },
  },
  isPublished: true,
  createdAt: true,
  teacher: { select: { id: true, name: true, avatarUrl: true } },
  _count: { select: { interests: true } },
} satisfies Prisma.OfferingSelect;
