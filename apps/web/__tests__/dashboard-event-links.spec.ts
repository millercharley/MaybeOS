import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Where the dashboard sends somebody looking for an event (EVT-39).
 *
 * `/member/<slug>/events` is **My Events** — the ones you host. The co-op's
 * listing, the one with everything that is not private and the RSVP buttons,
 * is `/portal/<slug>/events`. The two read alike in a template literal and are
 * entirely different pages.
 *
 * Charley: "when there are no events listed under My Upcoming Events, the link
 * to explore events takes the user to My Events instead of the Events page."
 * So a member with nothing booked in was offered "Browse upcoming events" and
 * landed on a list of the events they themselves host — which, for somebody
 * who has never hosted one, is a second empty page.
 *
 * A source scan rather than a render: the fault is in a URL, and a URL is
 * exactly the sort of thing a test can read directly.
 */
const page = readFileSync(
  join(__dirname, '..', 'app/(app)/(dashboard)/member/[orgSlug]/page.tsx'),
  'utf8',
);

/**
 * The href on the link whose visible text is `label`.
 *
 * Matched as a JSX text node — the label on its own line between tags — and not
 * as a bare substring, because the comments in that file quote these labels
 * while explaining the fix and a plain `indexOf` finds the prose first.
 */
function hrefNear(label: string): string {
  const text = new RegExp(`>\\s*${label}\\s*<`);
  const found = page.match(text);
  expect(found).not.toBeNull();

  const before = page.slice(0, found!.index);
  const open = before.lastIndexOf('<Link');
  const href = before.slice(open).match(/href=\{`([^`]+)`\}/);

  expect(href).not.toBeNull();
  return href![1];
}

describe('the member dashboard links to events', () => {
  it('sends somebody with no RSVPs to the co-op listing, not to their own', () => {
    expect(hrefNear('Browse upcoming events')).toBe('/portal/${orgSlug}/events');
  });

  it('means the co-op by "All events" beside what is on today', () => {
    expect(hrefNear('All events')).toBe('/portal/${orgSlug}/events');
  });

  it('never offers My Events as the way to find something to go to', () => {
    // The whole class of bug, not just the two instances of it. Links to a
    // single event under /portal/.../events/<slug> are untouched by this.
    const browse = ['Browse upcoming events', 'All events'];
    for (const label of browse) {
      expect(hrefNear(label)).not.toContain('/member/');
    }
  });
});
