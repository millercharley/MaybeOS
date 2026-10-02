/**
 * The RSVP button in a Radar digest (RDR-01).
 *
 * The button links to the event's own page carrying `?rsvp=radar`, rather
 * than to an endpoint that books a seat and says "done" on a bare page. A
 * member who presses it lands on the event with their seat already taken,
 * which is both the proof and the page they wanted anyway.
 *
 * The rules for when that parameter may be acted on live here, out of the
 * component. The failure they prevent is a member being booked twice, or
 * booked by a mail client's link preview — and nothing in this harness
 * renders a page, so a rule kept inside the component is a rule nothing can
 * check.
 */
export const RADAR_RSVP_PARAM = 'rsvp';
export const RADAR_RSVP_VALUE = 'radar';

/** Whether this address is asking the page to RSVP. `search` is `location.search`. */
export function rsvpRequested(search: string): boolean {
  return new URLSearchParams(search).get(RADAR_RSVP_PARAM) === RADAR_RSVP_VALUE;
}

/**
 * The same address with the Radar parameter taken off, so a refresh is an
 * ordinary visit to the event.
 *
 * A removal rather than "drop the query string", which is what the other
 * one-shot flags in this app do when they clear themselves. The event page
 * also reads `?purchased=1` and `?purchase=canceled` on the way back from
 * Stripe, and throwing the whole query away would silently swallow those.
 */
export function withoutRsvpParam(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(RADAR_RSVP_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

export interface RsvpArrival {
  /** `?rsvp=radar` is on the address. */
  requested: boolean;
  /** The session is known and the event has loaded. Nothing fires before this. */
  ready: boolean;
  /** Signed in and a member of *this* co-op — anybody else has nothing to RSVP with. */
  canRsvp: boolean;
  /** A ticketed event is bought, not RSVPed; its page offers no RSVP at all. */
  ticketed: boolean;
  /**
   * The RSVP this member already holds, as the page has read it. A canceled
   * one does not count: the API revives it, and somebody who canceled and
   * then followed a fresh digest link means to come after all.
   */
  existing: 'CONFIRMED' | 'WAITLISTED' | null;
}

/**
 * Whether the page should RSVP by itself on arrival.
 *
 * `existing` is the one that bites. The API answers a repeat RSVP with a 409
 * — "You have already RSVPed to this event" — and the page renders whatever
 * the RSVP failed with, so a member who is already going and opens the next
 * digest would be greeted by an error for a seat they already have. Pressing
 * the button has always been able to produce that; a page that presses the
 * button for them produces it without anybody asking.
 */
export function shouldRsvpOnArrival(arrival: RsvpArrival): boolean {
  return (
    arrival.requested &&
    arrival.ready &&
    arrival.canRsvp &&
    !arrival.ticketed &&
    arrival.existing === null
  );
}
