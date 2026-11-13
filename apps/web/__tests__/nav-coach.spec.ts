import { readCoach, setCoach, reachedMembership } from '@/lib/nav-coach';

/**
 * The first-run tour that points a phone user at the drawer (NAV-05).
 *
 * The rule worth protecting is where the tour *ends*: on the member's own
 * pages, and not on the dashboard they started from. Get that wrong in one
 * direction and the tour never clears; wrong in the other and it clears
 * before anybody has seen it.
 */
describe('where the tour ends', () => {
  it('ends on a page inside My membership', () => {
    expect(reachedMembership('/member/maybeitsfate/profile')).toBe(true);
    expect(reachedMembership('/member/maybeitsfate/bookings')).toBe(true);
    expect(reachedMembership('/member/maybeitsfate/billing')).toBe(true);
  });

  it('does not end on the dashboard, which is where it begins', () => {
    // The whole point: the member is already here when the tip is drawn. If
    // this counted, the tour would settle itself before being seen.
    expect(reachedMembership('/member/maybeitsfate')).toBe(false);
  });

  it('ignores the co-op picker, the portal and the admin', () => {
    expect(reachedMembership('/member')).toBe(false);
    expect(reachedMembership('/portal/maybeitsfate/events')).toBe(false);
    expect(reachedMembership('/admin/maybeitsfate/members')).toBe(false);
  });

  it('survives a trailing slash and a deeper page', () => {
    expect(reachedMembership('/member/maybeitsfate/events/123')).toBe(true);
    expect(reachedMembership('/member/maybeitsfate/')).toBe(false);
  });

  it('treats a missing address as not-arrived rather than throwing', () => {
    expect(reachedMembership(null)).toBe(false);
    expect(reachedMembership(undefined)).toBe(false);
  });
});

describe('what this browser has been shown', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts at the beginning', () => {
    expect(readCoach()).toBe('menu');
  });

  it('remembers each beat', () => {
    setCoach('membership');
    expect(readCoach()).toBe('membership');

    setCoach('done');
    expect(readCoach()).toBe('done');
  });

  it('reads anything unrecognised as the beginning, not as an error', () => {
    window.localStorage.setItem('maybeos.nav-coach', 'whatever-an-older-build-wrote');
    expect(readCoach()).toBe('menu');
  });

  it('says done when storage throws, rather than showing the tour forever', () => {
    // A private window throws on every read. The shell renders this on every
    // signed-in page, so the failure has to be silent *and* has to settle —
    // a tour that cannot record being seen would otherwise be shown for good.
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    expect(readCoach()).toBe('done');

    getItem.mockRestore();
  });

  it('does not throw when storage refuses the write', () => {
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('blocked');
      });

    expect(() => setCoach('done')).not.toThrow();

    setItem.mockRestore();
  });
});
