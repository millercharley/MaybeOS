import { Prisma } from '@prisma/client';

/**
 * What an event published to the open internet may contain (SEC-12).
 *
 * Three unauthenticated routes return events — the public list, the public
 * event page and the JSON feed — and all three used `include`, which returns
 * every column of the event *and every column of the room it is in*.
 *
 * `Room` holds `googleTokens`: the OAuth tokens for the co-op's connected
 * Google account, stored as JSON. **Eight of nine rooms on production hold
 * one.** Nothing had leaked yet only because no public event was attached to
 * a room — publishing one, which is the entire point of the feature, would
 * have put a co-op's Google credentials on an endpoint that answers to
 * anybody. The room's connected-calendar id, its calendar name and the
 * organiser's Google address travelled with it.
 *
 * The event's own row carried less but still more than it should: `hostId`,
 * which is a member's user id on a page that deliberately withholds the
 * host's *name*; and `hostRevenueShareBps`, the split the co-op agreed with
 * that host.
 *
 * A select, not a redaction list, for the reason MEM-14 and SEC-11 give: a
 * column added to the model tomorrow is absent from a select and present in a
 * delete-list somebody forgot to update. `googleTokens` is exactly a column
 * that arrived on an existing model long after these endpoints were written.
 */
export const PUBLIC_EVENT_SELECT = {
  id: true,
  orgId: true,
  title: true,
  slug: true,
  description: true,
  richDescription: true,
  imageUrl: true,
  startTime: true,
  endTime: true,
  timezone: true,
  visibility: true,
  recurrence: true,
  recurrenceEnd: true,
  capacity: true,
  priceCents: true,
  currency: true,
  waitlistEnabled: true,
  requiresRsvp: true,
  category: true,
  tags: true,
  hasCost: true,
  // Public by nature: it is on the poster, and the person deciding whether to
  // bring their teenager is exactly who reads a public event page (SPC-22).
  maturityLevel: true,
  isPublished: true,
  publishedAt: true,
  canceledAt: true,

  // The venue, which is the point of publishing an event. A co-op's address
  // is on the poster; its Google refresh token is not.
  location: {
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      country: true,
      timezone: true,
    },
  },
  room: { select: { id: true, name: true } },

  _count: { select: { rsvps: { where: { status: 'CONFIRMED' as const } } } },
} satisfies Prisma.EventSelect;
