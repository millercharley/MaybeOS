import {
  guestRsvpReady,
  guestRsvpConfirmation,
  submitGuestRsvp,
  NEED_BOTH,
} from '@/lib/guest-rsvp';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { events: { guestRsvp: jest.fn() } },
}));

const guestRsvp = api.events.guestRsvp as unknown as jest.Mock;

/**
 * Saying you are coming without an account (EVT-49).
 *
 * Charley: "Make sure non-members can RSVP." The API has served guest RSVPs
 * since PUB-05 and the public list has always used them — but the *event
 * page*, where every link to an event lands, told a stranger to sign in.
 *
 * Two pages call this now, which is the reason the rules are here rather than
 * inside either of them.
 */
describe('a guest RSVP', () => {
  beforeEach(() => guestRsvp.mockReset());

  describe('what the host needs', () => {
    it('wants both a name and an address', () => {
      expect(guestRsvpReady('Ada', 'ada@example.com')).toBe(true);
    });

    it.each([
      ['no name', '', 'ada@example.com'],
      ['no address', 'Ada', ''],
      ['a name of spaces', '   ', 'ada@example.com'],
      ['an address of spaces', 'Ada', '   '],
    ])('refuses %s', (_label, name, email) => {
      expect(guestRsvpReady(name, email)).toBe(false);
    });

    it('says so rather than sending nothing', async () => {
      const result = await submitGuestRsvp({
        orgId: 'org-1',
        eventId: 'event-1',
        name: '',
        email: 'ada@example.com',
      });

      expect(result).toEqual({ kind: 'failed', message: NEED_BOTH });
      expect(guestRsvp).not.toHaveBeenCalled();
    });
  });

  /**
   * A name pasted from a phone keyboard arrives with a trailing space, and an
   * address with one does not match the address the same person's ticket was
   * bought under — which is how one person becomes two rows on a door list.
   */
  it('trims what it sends', async () => {
    guestRsvp.mockResolvedValue({ status: 'CONFIRMED' });

    await submitGuestRsvp({
      orgId: 'org-1',
      eventId: 'event-1',
      name: '  Ada Lovelace ',
      email: ' ada@example.com  ',
    });

    expect(guestRsvp).toHaveBeenCalledWith('org-1', 'event-1', {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    });
  });

  describe('what the API decides', () => {
    it('reports a confirmed place', async () => {
      guestRsvp.mockResolvedValue({ status: 'CONFIRMED' });

      await expect(
        submitGuestRsvp({ orgId: 'o', eventId: 'e', name: 'Ada', email: 'a@b.com' }),
      ).resolves.toEqual({ kind: 'done', status: 'CONFIRMED' });
    });

    /**
     * The answer worth getting right. Telling somebody they have a place when
     * they are on a waitlist is how they stop looking for another way in and
     * turn up to a full room.
     */
    it('reports a waitlist as a waitlist', async () => {
      guestRsvp.mockResolvedValue({ status: 'WAITLISTED' });

      await expect(
        submitGuestRsvp({ orgId: 'o', eventId: 'e', name: 'Ada', email: 'a@b.com' }),
      ).resolves.toEqual({ kind: 'done', status: 'WAITLISTED' });
    });

    it.each([
      ['an API that said nothing', {}],
      ['an API that sent null', null],
      ['a status it does not know', { status: 'SOMETHING_ELSE' }],
    ])('falls back to confirmed for %s', async (_label, reply) => {
      guestRsvp.mockResolvedValue(reply);

      await expect(
        submitGuestRsvp({ orgId: 'o', eventId: 'e', name: 'Ada', email: 'a@b.com' }),
      ).resolves.toEqual({ kind: 'done', status: 'CONFIRMED' });
    });

    it('passes the API’s own refusal through', async () => {
      guestRsvp.mockRejectedValue(new Error('This event has already happened'));

      await expect(
        submitGuestRsvp({ orgId: 'o', eventId: 'e', name: 'Ada', email: 'a@b.com' }),
      ).resolves.toEqual({ kind: 'failed', message: 'This event has already happened' });
    });

    it('says something human when the failure has no message', async () => {
      guestRsvp.mockRejectedValue('nope');

      const result = await submitGuestRsvp({
        orgId: 'o',
        eventId: 'e',
        name: 'Ada',
        email: 'a@b.com',
      });

      expect(result).toEqual({ kind: 'failed', message: 'That did not go through.' });
    });
  });

  describe('what it says afterwards', () => {
    it('does not promise a place to somebody on the waitlist', () => {
      expect(guestRsvpConfirmation('WAITLISTED')).toMatch(/waitlist/i);
      expect(guestRsvpConfirmation('WAITLISTED')).not.toMatch(/see you there/i);
    });

    it('confirms a place plainly', () => {
      expect(guestRsvpConfirmation('CONFIRMED')).toMatch(/see you there/i);
    });
  });
});
