import { readFileSync } from 'fs';
import { join } from 'path';
import { MATURITY_LEVELS, maturityBadge } from '@/lib/maturity';

/**
 * The events embed, on somebody else's website (EVT-48).
 *
 * Charley: "the embed does not include buttons to learn more about an event
 * or to get tickets. I would like for the event list to look the same as the
 * one members see -- just make sure only public events are listed."
 *
 * `embed.js` is plain script served to a co-op's own domain, so it can import
 * nothing and nothing can render it here. What is testable is the file: the
 * rules it must keep, and the places it duplicates something this repo also
 * states somewhere else.
 */
const RAW = readFileSync(join(__dirname, '..', 'public', 'embed.js'), 'utf8');

/**
 * Comments stripped first.
 *
 * Every forbidden word below also appears in this file's own prose, where it
 * is explaining why the thing is forbidden — so a bare search over the raw
 * source fails on the documentation of the rule it is checking. The same
 * lesson `unauthenticated-routes.spec.ts` and `tenant-scoping.spec.ts` both
 * had to learn.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('the events embed', () => {
  it('has a file to read, and comments really were stripped', () => {
    expect(SOURCE.length).toBeGreaterThan(1000);
    // Guards the strip itself: if it ever became a no-op, every check below
    // would start passing or failing for the wrong reason.
    expect(RAW).toContain('rather than innerHTML');
    expect(SOURCE).not.toContain('rather than innerHTML');
  });

  /**
   * The line that must not move (SEC-12).
   *
   * The member list's hero shows faces and "2 people going". A co-op's public
   * website must not: an event link may be public so strangers can RSVP, but
   * who is attending is not. The API does not send it; this is the other end.
   */
  it('renders nothing about who is attending', () => {
    for (const forbidden of ['rsvpFaces', 'rsvpCount', 'rsvps', 'avatar', 'attendee']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  /**
   * A title is text a co-op typed, rendered onto their own domain. Building
   * markup from it is how an event title becomes script on their site.
   */
  it('never builds markup from a string', () => {
    expect(SOURCE).not.toMatch(/\binnerHTML\b/);
    expect(SOURCE).not.toMatch(/\bouterHTML\b/);
    expect(SOURCE).not.toMatch(/insertAdjacentHTML/);
  });

  /** `target="_blank"` without it hands the new page a handle on the co-op's. */
  it('opens the event page without handing it a window reference', () => {
    expect(SOURCE).toContain("rel = 'noopener'");
  });

  /**
   * The age labels are duplicated here because the file cannot import them.
   * Duplication is fine; drift is not, and only a test can tell them apart.
   */
  it('uses the same age labels as the rest of the product', () => {
    const restricting = MATURITY_LEVELS.filter((level) => maturityBadge(level.value));

    expect(restricting.length).toBeGreaterThan(0);

    for (const level of restricting) {
      expect(SOURCE).toContain(`${level.value}: '${level.label}'`);
    }
  });

  /**
   * All-ages shows nothing, the same rule `maturityBadge` states: a badge on
   * every row trains people to stop reading badges.
   */
  it('shows no badge for an all-ages event', () => {
    expect(maturityBadge('ALL_AGES')).toBeNull();
    expect(SOURCE).not.toContain("ALL_AGES: '");
  });

  /**
   * The price shown has to be the price charged. The embed printed the face
   * value, so a $10 ticket advertised $10 and rang up $11.75.
   */
  it('quotes the all-in total rather than the face value', () => {
    expect(SOURCE).toContain('event.totalCents');
    // The old field is still sent and may still be read, but not for the
    // figure on the button.
    expect(SOURCE).not.toMatch(/money\(\s*event\.priceCents/);
  });

  /** Buying needs a seat count and an address; a marketing site links out. */
  it('sends the button to the event page rather than anywhere it built itself', () => {
    expect(SOURCE).toContain('go.href = event.url');
    // The URL is built by the API, so the script holds no rule about
    // MaybeOS's address shape — and cannot send somebody somewhere it guessed.
    expect(SOURCE).not.toMatch(/go\.href\s*=\s*['"`]/);
  });
});
