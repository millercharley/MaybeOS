import { publishPrompt, publishedNotice } from '@/lib/publish-prompt';

/**
 * How a member is offered the chance to publish their booking (EVT-17).
 *
 * The question differs by who the booking is open to. "Publish as event" asked
 * flatly is a button most people do not press, because it does not say what it
 * does or who would see it.
 */
describe('publishPrompt', () => {
  it('asks about members for a members-only booking', () => {
    const prompt = publishPrompt('MEMBERS_ONLY');

    expect(prompt?.question).toBe('Publish this to the event list for members?');
    expect(prompt?.detail).toContain('stays off the public site');
  });

  it('asks about the public for a public booking', () => {
    const prompt = publishPrompt('PUBLIC');

    expect(prompt?.question).toBe('Publish this to the event list for the public?');
    expect(prompt?.detail).toContain('outside the co-op');
  });

  it('does not ask at all about a private booking', () => {
    // Somebody who said "just my guests" has answered this already. Offering
    // anyway asks them to decline a thing they never raised, on the screen
    // that just confirmed their booking.
    expect(publishPrompt('PRIVATE')).toBeNull();
  });

  it('does not ask when nothing was answered', () => {
    // Bookings made before SPC-21 carry no visibility.
    expect(publishPrompt(null)).toBeNull();
    expect(publishPrompt(undefined)).toBeNull();
  });

  it('names a distinct action for each', () => {
    // Two buttons reading "Publish" side by side in a changelog is how the
    // difference gets lost.
    expect(publishPrompt('MEMBERS_ONLY')?.action).not.toBe(publishPrompt('PUBLIC')?.action);
  });
});

describe('publishedNotice', () => {
  it('says who can see it, once it is live', () => {
    expect(publishedNotice('PUBLIC')).toContain('anyone can see it');
    expect(publishedNotice('MEMBERS_ONLY')).toContain('for members');
  });

  it('warns that cancelling the booking calls off the event', () => {
    // EVT-05 does this automatically, and a member who does not know will
    // cancel a room and leave people turning up to a cancelled event.
    for (const v of ['PUBLIC', 'MEMBERS_ONLY'] as const) {
      expect(publishedNotice(v)).toContain('cancel this booking');
    }
  });
});
