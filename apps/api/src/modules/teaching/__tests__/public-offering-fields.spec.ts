import { MEMBER_OFFERING_SELECT, PUBLIC_OFFERING_SELECT } from '../offering-view';

/**
 * What a teaching offering published to the open internet may contain
 * (TCH-01, following SEC-12).
 *
 * The thing being published here is **a member**, which is the difference
 * from the events embed. An event is a co-op advertising its own calendar; an
 * offering is a person saying "I teach this, come and find me", and
 * everything hanging off it points at somebody.
 *
 * `User` carries `email`, `passwordHash`, `magicLinkToken` and
 * `passwordResetToken`. An `include` on that relation would return the lot —
 * which is exactly how SEC-12 put a co-op's Google refresh tokens on a public
 * endpoint. So the teacher travels as a name and a picture, and this test is
 * what says so out loud.
 */
describe('what reaches the open web', () => {
  it('gives the teacher a name and a face and nothing else', () => {
    expect(Object.keys(PUBLIC_OFFERING_SELECT.teacher.select).sort()).toEqual([
      'avatarUrl',
      'name',
    ]);
  });

  it.each([
    'email',
    'passwordHash',
    'magicLinkToken',
    'passwordResetToken',
    'passwordResetExpiry',
    'id',
    'lastLoginAt',
    'globalRole',
  ])('never publishes the teacher’s %s', (field) => {
    expect(PUBLIC_OFFERING_SELECT.teacher.select).not.toHaveProperty(field);
  });

  /**
   * An interest note is a learner writing privately to a teacher — "I am a
   * complete beginner", "money is tight this month". The count alone would
   * tell a stranger how in-demand a particular member is. Neither belongs on
   * a marketing page.
   */
  it('publishes nobody’s interest, and no count of it', () => {
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('interests');
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('_count');
  });

  it('does not publish who wrote it up', () => {
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('createdById');
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('createdBy');
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('teacherId');
  });

  /** A draft's own state is not a visitor's business either. */
  it('does not publish whether it is a draft', () => {
    expect(PUBLIC_OFFERING_SELECT).not.toHaveProperty('isPublished');
  });

  /**
   * A session listed under its offering needs when, where and what it costs.
   * Not its RSVP count, not the room's id — a visitor who wants the rest
   * follows the event page, which is already public and already tested.
   */
  it('narrows a session to what a listing needs', () => {
    const session = PUBLIC_OFFERING_SELECT.sessions.select;

    expect(Object.keys(session).sort()).toEqual([
      'capacity',
      'currency',
      'endTime',
      'location',
      'maturityLevel',
      'priceCents',
      'slug',
      'startTime',
      'timezone',
      'title',
    ]);
    expect(Object.keys(session.location.select)).toEqual(['name']);
  });

  it.each(['googleTokens', 'googleAccountEmail', 'googleCalendarId', 'id'])(
    'never reaches a session’s room, or its %s',
    (field) => {
      const session = PUBLIC_OFFERING_SELECT.sessions.select as Record<string, unknown>;
      expect(session).not.toHaveProperty('room');
      expect(session.location).not.toHaveProperty(field);
    },
  );

  it('does not hand out RSVP faces or counts for a session', () => {
    const session = PUBLIC_OFFERING_SELECT.sessions.select as Record<string, unknown>;
    expect(session).not.toHaveProperty('rsvps');
    expect(session).not.toHaveProperty('_count');
  });
});

/**
 * What a signed-in member sees on top of that — four things, and no more.
 */
describe('what a member sees that a stranger does not', () => {
  it('adds exactly the four things it means to', () => {
    const extra = Object.keys(MEMBER_OFFERING_SELECT).filter(
      (key) => !(key in PUBLIC_OFFERING_SELECT),
    );
    expect(extra.sort()).toEqual(['_count', 'createdAt', 'isPublished']);

    // And the teacher gains an id, so the page can link to their profile in
    // the directory — which is behind the same sign-in.
    expect(Object.keys(MEMBER_OFFERING_SELECT.teacher.select).sort()).toEqual([
      'avatarUrl',
      'id',
      'name',
    ]);
  });

  /**
   * A count of how many people asked is the same kind of fact as an event's
   * RSVP count, which members already see. **The notes are not**: those are
   * fetched by the teacher's own route, which checks `canSeeInterest`.
   */
  it('counts the interest without reading any of it', () => {
    expect(MEMBER_OFFERING_SELECT._count.select).toEqual({ interests: true });
    expect(MEMBER_OFFERING_SELECT).not.toHaveProperty('interests');
  });

  it('still never carries the teacher’s address', () => {
    expect(MEMBER_OFFERING_SELECT.teacher.select).not.toHaveProperty('email');
  });
});
