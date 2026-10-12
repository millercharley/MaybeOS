import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A seat you hold still looks held tomorrow (EVT-45).
 *
 * Charley: "If you RSVP for an event it says 'Going' and then if you open the
 * Events page later, it doesn't say 'Going' anymore but has the RSVP again.
 * Keep something labeled as Going if the person committed to going, or
 * however they responded."
 *
 * `rsvpStatus` only ever recorded what happened while the page was open. The
 * member's own record said they were going; the page never asked — and
 * pressing the button it offered answers 409, "You have already RSVPed to
 * this event".
 */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const read = (...p: string[]) => strip(readFileSync(join(__dirname, '..', ...p), 'utf8'));

const list = read('app', '(app)', 'portal', '[orgSlug]', 'events', 'page.tsx');
const detail = read('app', '(app)', 'portal', '[orgSlug]', 'events', '[eventSlug]', 'page.tsx');
const cards = read('components', 'events', 'event-cards.tsx');

describe('the events list', () => {
  it('asks what the member already holds', () => {
    expect(list).toMatch(/api\.events[\s\S]{0,40}\.myRsvps\(org\.id, token\)/);
  });

  it('shows a held seat as held, both kinds', () => {
    // A waitlisted place and a confirmed one are different news, and neither
    // is "RSVP".
    expect(list).toMatch(/rsvp\.status === 'CONFIRMED' \|\| rsvp\.status === 'WAITLISTED'/);
    expect(cards).toMatch(/status === 'CONFIRMED' \? 'Going' : 'On the waitlist'/);
  });

  it('offers the button again to somebody who dropped out', () => {
    // CANCELED is not a seat. This is the one case the old behaviour got
    // right, by accident, and it must survive the fix.
    expect(list).not.toMatch(/'CANCELED'/);
  });

  it('does not overwrite a press that landed while it was asking', () => {
    // The seeded answer is older than anything decided since.
    expect(list).toMatch(/setRsvpStatus\(\(current\) => \(\{ \.\.\.held, \.\.\.current \}\)\)/);
  });

  it('asks only for a member, who is the only one who can hold a seat', () => {
    expect(list).toMatch(/if \(!org \|\| !token \|\| !isMember\) return;/);
  });

  it('leaves the page working if the question fails', () => {
    // The button still works and the API still refuses a duplicate.
    expect(list).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('the event page, which already knew', () => {
  it('still asks too, so the two surfaces agree', () => {
    /*
      The detail page learned this for the Radar digest's RSVP link, which
      makes the page press the button unprompted — so it had to know the
      answer before acting. The list had the same gap for the ordinary
      reason and nobody had joined them up.
    */
    expect(detail).toMatch(/\.myRsvps\(org\.id, token\)/);
  });
});
