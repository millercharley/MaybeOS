import { initialPassState, isPass, passNotice, seatLine } from '@/lib/ticket-pass';

/**
 * The door pass page's decisions (EVT-46).
 *
 * This app's harness renders no components, so the logic lives in `lib/` and
 * the page is markup around it — the pattern `radar-unsubscribe.ts` set, for
 * the reason OPS-10 gave: a state machine inside a component is a state
 * machine nothing can call.
 */
describe('the ticket pass page', () => {
  const aPass = (over: Record<string, unknown> = {}) => ({
    event: {
      title: 'Dog Sees God',
      when: 'Thursday, October 29, 2026 at 7:00 PM',
      where: 'The Gallery',
      orgName: 'MaybeItsFate',
      canceled: false,
      past: false,
    },
    holder: { name: 'Annette M Neblett', email: 'netneb1958@gmail.com' },
    seats: 2,
    boughtAt: '2026-10-22T15:57:14Z',
    ...over,
  });

  describe('isPass', () => {
    it('accepts a pass', () => {
      expect(isPass(aPass())).toBe(true);
    });

    /**
     * The API answers `{ ok: false }` for a forged token, a deleted event and
     * a refunded buyer alike — one answer for all of them, so a guessed token
     * cannot be used to find out whether it named a real sale. This is the
     * other half of that: the page must not read the refusal as a pass whose
     * fields happen to be missing.
     */
    it('rejects the refusal the API sends for everything that went wrong', () => {
      expect(isPass({ ok: false })).toBe(false);
    });

    it.each([
      ['null', null],
      ['a string', 'ok'],
      ['no event', { holder: { email: 'a@b.com' }, seats: 1 }],
      ['no holder', { event: { title: 'x', when: 'y' }, seats: 1 }],
      ['a null event', { event: null, holder: { email: 'a@b.com' }, seats: 1 }],
      ['a title that is not a string', aPass({ event: { title: 7, when: 'y' } })],
      ['no seat count', { event: { title: 'x', when: 'y' }, holder: { email: 'a@b.com' } }],
      ['seats as a string', aPass({ seats: '2' })],
      // A pass with nothing on it is not a pass. The API returns the refusal
      // instead of this, so it guards a future change rather than today.
      ['zero seats', aPass({ seats: 0 })],
      ['negative seats', aPass({ seats: -1 })],
    ])('rejects %s', (_label, value) => {
      expect(isPass(value)).toBe(false);
    });
  });

  describe('initialPassState', () => {
    /**
     * A link copied out of an email by hand loses its query string often
     * enough to deserve its own state: say so on arrival rather than after a
     * round trip that was never going to succeed.
     */
    it.each([
      ['no token', undefined],
      ['a null token', null],
      ['an empty token', ''],
    ])('starts on the bad-link page with %s', (_label, token) => {
      expect(initialPassState(token)).toEqual({ kind: 'badLink' });
    });

    it('loads when there is a token to load', () => {
      expect(initialPassState('abc.def')).toEqual({ kind: 'loading' });
    });
  });

  describe('seatLine', () => {
    it('is singular for one', () => {
      expect(seatLine(1)).toBe('1 seat');
    });

    /** Annette's case: two checkouts, one pass, one number. */
    it('is plural for more', () => {
      expect(seatLine(2)).toBe('2 seats');
      expect(seatLine(11)).toBe('11 seats');
    });
  });

  describe('passNotice', () => {
    /** Nothing in the way of the number, on a normal night. */
    it('says nothing about an event that is still to come', () => {
      expect(passNotice(aPass().event)).toBeNull();
    });

    it('says a cancelled event is cancelled, and where the money went', () => {
      const notice = passNotice({ ...aPass().event, canceled: true });

      expect(notice).toContain('cancelled');
      expect(notice).toContain('refund');
    });

    it('says a past event has already happened', () => {
      expect(passNotice({ ...aPass().event, past: true })).toContain('already happened');
    });

    /**
     * Cancelled wins over past. A show cancelled last week is a refund
     * question, not a history question, and the refund is what the person
     * holding the pass needs to read.
     */
    it('prefers the cancellation when an event was cancelled and is also past', () => {
      const notice = passNotice({ ...aPass().event, canceled: true, past: true });

      expect(notice).toContain('refund');
    });
  });
});
