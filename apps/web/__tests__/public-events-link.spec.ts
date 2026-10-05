import { readFileSync } from 'fs';
import { join } from 'path';
import { leavesMaybeOs, publicEventsHref } from '@/lib/public-events';

/**
 * Where "View all events" sends somebody (PUB-05).
 *
 * Charley: "Make sure the View all events link takes the user to a public view
 * of events at the community. Ask the admin for the link on the Join Page tab
 * in the Admin Settings. If the URL entry is left blank, show a single page of
 * events that do not require a logged in user to view, RSVP, and buy tickets."
 */
describe('the link', () => {
  it('uses the co-op’s own events page when they have given one', () => {
    expect(publicEventsHref('maybeitsfate', 'https://maybeitsfate.com/events')).toBe(
      'https://maybeitsfate.com/events',
    );
  });

  it('falls back to the page MaybeOS hosts when the field is blank', () => {
    // Blank is an answer, not an omission.
    expect(publicEventsHref('maybeitsfate', null)).toBe('/orgs/maybeitsfate/events');
    expect(publicEventsHref('maybeitsfate', '')).toBe('/orgs/maybeitsfate/events');
    expect(publicEventsHref('maybeitsfate', '   ')).toBe('/orgs/maybeitsfate/events');
  });

  it('knows when it is leaving MaybeOS, so it can open in a new tab', () => {
    expect(leavesMaybeOs('https://maybeitsfate.com/events')).toBe(true);
    expect(leavesMaybeOs('/orgs/maybeitsfate/events')).toBe(false);
  });
});

/**
 * The page the fallback leads to. Scanned rather than rendered: what matters
 * is that it is a public page offering the three unauthenticated things, and
 * both of those are visible in the source.
 */
describe('the page MaybeOS hosts', () => {
  const page = readFileSync(
    join(__dirname, '..', 'app/(public)/orgs/[slug]/events/page.tsx'),
    'utf8',
  );

  it('lives outside the signed-in app', () => {
    /*
      The old link went to `/portal/<slug>/events`, which is readable without
      an account but draws the app's shell around it — a visitor arriving from
      a co-op's own website met a sidebar full of things they cannot open.
    */
    expect(page).toContain('(public)');
  });

  it('offers the three things a visitor came to do', () => {
    // View, RSVP, buy a ticket — all three already worked without an account;
    // what was missing was a page that offered them.
    expect(page).toContain('api.events.listPublic');
    expect(page).toContain('api.events.guestRsvp');
    expect(page).toContain('api.events.buyTicket');
  });

  it('asks a guest for a name and an address before counting them', () => {
    // An RSVP with neither is a number rather than a person, and the host
    // standing at the door needs the person.
    expect(page).toContain('Your name');
    expect(page).toContain('Your email');
  });

  it('believes the API about a full event rather than assuming', () => {
    // A waitlisted RSVP answers WAITLISTED rather than refusing, and telling
    // somebody they have a place when they do not is the one outcome here
    // worth avoiding.
    expect(page).toContain('WAITLISTED');
  });
});

/**
 * The client method behind the RSVP, which had never worked.
 */
describe('guest RSVP', () => {
  const client = readFileSync(join(__dirname, '..', 'lib/api.ts'), 'utf8');

  it('posts to the route the API actually serves', () => {
    // It was `/guest-rsvp`; the API has always served `/rsvp/guest`. Nothing
    // called it until this page, which is why nobody noticed.
    //
    // Matched on the request itself, not on the file: the comment above the
    // method quotes the old path while explaining the fix.
    const call = client.slice(client.indexOf('guestRsvp:'));
    const path = call.slice(0, call.indexOf("},"));
    expect(path).toContain('/rsvp/guest');
    expect(path).not.toContain('/guest-rsvp');
  });

  it('sends the field names the DTO asks for', () => {
    expect(client).toContain('guestName: data.name');
    expect(client).toContain('guestEmail: data.email');
  });
});
