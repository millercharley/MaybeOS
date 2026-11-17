import {
  LESSONS_NOT_YET_PAYABLE,
  NOT_YOUR_OFFERING,
  UNTITLED_SLUG,
  canChargeThroughMaybeOS,
  canEditOffering,
  canSeeInterest,
  isScheduled,
  mayHaveSessions,
  offeringIsListed,
  offeringSlug,
  visibleTo,
} from '../offering-control';

/**
 * Who may change an offering, and who may see one (TCH-01).
 *
 * Every function here is a policy decision, so every one of them is tested
 * directly rather than through a Prisma mock — the arrangement the events
 * module uses for `host-control.ts`.
 */
describe('who may edit an offering', () => {
  const offering = { teacherId: 'teacher', createdById: 'organiser' };

  it('lets the teacher', () => {
    expect(canEditOffering(offering, 'teacher', false)).toBe(true);
  });

  /**
   * The case that needs writing down. An organiser writing an offering for a
   * member who does not use the web app much would otherwise lose their claim
   * on it the moment they named the teacher — the same reason
   * `Event.createdById` exists (EVT-32).
   */
  it('lets whoever wrote it up, even once somebody else teaches it', () => {
    expect(canEditOffering(offering, 'organiser', false)).toBe(true);
  });

  it('lets an organiser', () => {
    expect(canEditOffering(offering, 'nobody-in-particular', true)).toBe(true);
  });

  it('refuses everybody else', () => {
    expect(canEditOffering(offering, 'another-member', false)).toBe(false);
  });

  it('refuses when there is no creator to match', () => {
    expect(canEditOffering({ teacherId: 't', createdById: null }, 'x', false)).toBe(false);
  });

  /** A learner's note is addressed to the teacher, not to the co-op. */
  it('gives the interest list to exactly the same people', () => {
    expect(canSeeInterest).toBe(canEditOffering);
  });

  it('says why, in words somebody can act on', () => {
    expect(NOT_YOUR_OFFERING).toMatch(/organiser, the teacher, or whoever wrote this up/);
  });
});

describe('who may see an offering', () => {
  const published = (visibility: 'PUBLIC' | 'MEMBERS_ONLY' | 'PRIVATE') => ({
    visibility,
    isPublished: true,
  });

  it('shows a public one to anybody', () => {
    expect(offeringIsListed(published('PUBLIC'), false)).toBe(true);
    expect(offeringIsListed(published('PUBLIC'), true)).toBe(true);
  });

  it('shows a members-only one to members only', () => {
    expect(offeringIsListed(published('MEMBERS_ONLY'), true)).toBe(true);
    expect(offeringIsListed(published('MEMBERS_ONLY'), false)).toBe(false);
  });

  /**
   * PRIVATE means "not advertised", not "sealed" — the meaning the events
   * module already gives it. A second meaning for the same word would be
   * worse than either.
   */
  it('lists a private one for nobody, member or not', () => {
    expect(offeringIsListed(published('PRIVATE'), true)).toBe(false);
    expect(offeringIsListed(published('PRIVATE'), false)).toBe(false);
  });

  it('lists a draft for nobody', () => {
    expect(offeringIsListed({ visibility: 'PUBLIC', isPublished: false }, true)).toBe(false);
  });

  /** A forgetful caller must leak nothing. */
  it('assumes a stranger when nobody says otherwise', () => {
    expect(offeringIsListed(published('MEMBERS_ONLY'))).toBe(false);
    expect(visibleTo(false)).toEqual(['PUBLIC']);
    expect(visibleTo(true)).toEqual(['PUBLIC', 'MEMBERS_ONLY']);
  });

  it('never offers PRIVATE to a query, for anybody', () => {
    expect(visibleTo(true)).not.toContain('PRIVATE');
    expect(visibleTo(false)).not.toContain('PRIVATE');
  });
});

describe('workshops and private lessons', () => {
  it('lets a workshop have dates and a lesson not', () => {
    expect(mayHaveSessions('WORKSHOP')).toBe(true);
    expect(mayHaveSessions('PRIVATE_LESSON')).toBe(false);
  });

  /**
   * A workshop with no dates is not half-finished — Charley asked for it:
   * "not required if just gathering interest or sign ups".
   */
  it('treats a workshop with no dates as a state, not an error', () => {
    expect(isScheduled(0)).toBe(false);
    expect(isScheduled(1)).toBe(true);
  });

  /**
   * Paid private lessons are the half of TCH-01 that is not built.
   * `Ticket.eventId` and `HostPayout.eventId` are both non-null, so a lesson
   * has nothing to hang a purchase on. This refuses rather than offering a
   * checkout that cannot complete.
   */
  it('cannot take money for a lesson yet, and says what to do instead', () => {
    expect(canChargeThroughMaybeOS('WORKSHOP')).toBe(true);
    expect(canChargeThroughMaybeOS('PRIVATE_LESSON')).toBe(false);

    expect(LESSONS_NOT_YET_PAYABLE).toMatch(/arrange payment directly/);
    expect(LESSONS_NOT_YET_PAYABLE).toMatch(/workshop with dates/);
  });
});

describe('the slug', () => {
  it('kebab-cases a title', () => {
    expect(offeringSlug('Beginner Wheel Throwing')).toBe('beginner-wheel-throwing');
  });

  it('drops punctuation rather than encoding it', () => {
    expect(offeringSlug("Ada's Pottery: Level 1!")).toBe('ada-s-pottery-level-1');
  });

  it('does not leave a leading or trailing dash', () => {
    expect(offeringSlug('  — Hello —  ')).toBe('hello');
  });

  /**
   * No date prefix, unlike `Event.slug`. An event is one evening and its slug
   * says which; an offering outlives its sessions and may never have one, so
   * a date in the address would be a lie about half of them.
   */
  it('carries no date', () => {
    expect(offeringSlug('Pottery')).toBe('pottery');
    expect(offeringSlug('Pottery')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('leaves the caller something to fall back on', () => {
    expect(offeringSlug('!!!')).toBe('');
    expect(UNTITLED_SLUG).toBe('offering');
  });
});
