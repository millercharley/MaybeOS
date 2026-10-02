import {
  rsvpRequested,
  shouldRsvpOnArrival,
  withoutRsvpParam,
  RsvpArrival,
} from '@/lib/radar-rsvp';

/**
 * RSVPing straight from a Radar digest (RDR-01).
 *
 * The digest's button is a link to the event's own page carrying
 * `?rsvp=radar`, and the page acts on it so the member lands on proof their
 * seat is booked rather than on a form they have to fill in again.
 *
 * Everything below is about *not* acting on it. A page that books a seat
 * without being asked has to be much more careful than a button: a repeat
 * RSVP is a 409 the member never asked for, a ticketed event has no RSVP to
 * give, and a parameter left on the address books again on every refresh.
 */
describe('the RSVP link in a digest', () => {
  const coming: RsvpArrival = {
    requested: true,
    ready: true,
    canRsvp: true,
    ticketed: false,
    existing: null,
  };

  it('RSVPs for a member who followed the link', () => {
    expect(shouldRsvpOnArrival(coming)).toBe(true);
  });

  it('does nothing on an ordinary visit to the event', () => {
    expect(shouldRsvpOnArrival({ ...coming, requested: false })).toBe(false);
  });

  it('waits until the session and the event are both in', () => {
    // The guard that matters most: acting early means RSVPing with no event
    // to RSVP to, or deciding somebody is not a member before their profile
    // has loaded.
    expect(shouldRsvpOnArrival({ ...coming, ready: false })).toBe(false);
  });

  it('does not RSVP for somebody who cannot', () => {
    // A signed-out reader, or a member of a different co-op. The page
    // already shows them a sign-in prompt, which is the honest answer.
    expect(shouldRsvpOnArrival({ ...coming, canRsvp: false })).toBe(false);
  });

  it('leaves a ticketed event alone', () => {
    // A ticket is bought, not RSVPed, and the page offers no RSVP control at
    // all on one — so an automatic RSVP there would record a free seat and
    // show the member nothing for it.
    expect(shouldRsvpOnArrival({ ...coming, ticketed: true })).toBe(false);
  });

  it('does not book a seat the member already has', () => {
    // The API answers a repeat with 409 "You have already RSVPed to this
    // event", which the page renders as the RSVP error. Opening the second
    // digest would greet somebody with an error about a seat they hold.
    expect(shouldRsvpOnArrival({ ...coming, existing: 'CONFIRMED' })).toBe(false);
    expect(shouldRsvpOnArrival({ ...coming, existing: 'WAITLISTED' })).toBe(false);
  });
});

describe('reading the parameter off the address', () => {
  it('recognizes the digest’s own link', () => {
    expect(rsvpRequested('?rsvp=radar')).toBe(true);
    expect(rsvpRequested('?utm_source=mail&rsvp=radar')).toBe(true);
  });

  it('ignores anything else', () => {
    expect(rsvpRequested('')).toBe(false);
    expect(rsvpRequested('?rsvp=1')).toBe(false);
    expect(rsvpRequested('?purchased=1')).toBe(false);
  });
});

describe('clearing the parameter afterwards', () => {
  it('takes it off so a refresh is an ordinary visit', () => {
    expect(withoutRsvpParam('/portal/maybeitsfate/events/print-night', '?rsvp=radar')).toBe(
      '/portal/maybeitsfate/events/print-night',
    );
  });

  it('keeps everything else the link was carrying', () => {
    // The event page also reads `?purchased=1` and `?purchase=canceled` on
    // the way back from Stripe. Dropping the whole query string — which is
    // what the other one-shot flags in this app do — would swallow those.
    expect(
      withoutRsvpParam('/portal/maybeitsfate/events/print-night', '?purchased=1&rsvp=radar'),
    ).toBe('/portal/maybeitsfate/events/print-night?purchased=1');
  });

  it('leaves an address that never had it unchanged', () => {
    expect(withoutRsvpParam('/portal/maybeitsfate/events/print-night', '')).toBe(
      '/portal/maybeitsfate/events/print-night',
    );
  });
});
