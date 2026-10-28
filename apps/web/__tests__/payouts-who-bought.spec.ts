import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Payouts leads to who bought (EVT-51).
 *
 * Charley: "Make sure an Admin can open Payouts and click through any event
 * to see who bought tickets to the specific event."
 *
 * The screen that shows who bought already existed and nothing pointed at it
 * from here — the only way in was to know the URL. An organiser looking at a
 * payout is asking "who were these sales?", and the answer sat two screens
 * away with no path between them.
 *
 * A source scan, because the defect was a *missing link* and no test of what
 * the page does can see a link that is not there.
 */
const PAGE = readFileSync(
  join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'payouts', 'page.tsx'),
  'utf8',
);

describe('the payouts page', () => {
  it('has a page to read', () => {
    expect(PAGE).toContain('HostPayoutPreview');
  });

  it('links each event to the screen showing who bought', () => {
    expect(PAGE).toContain('/admin/${orgSlug}/events/${row.eventId}');
  });

  /**
   * Both lists, not just the one still owed. An organiser reconciling a
   * payment they already sent is exactly who needs to see the sales behind
   * it.
   */
  it('offers it from the paid list as well as the owed list', () => {
    const links = PAGE.match(/\/admin\/\$\{orgSlug\}\/events\/\$\{row\.eventId\}/g) ?? [];
    expect(links).toHaveLength(2);
  });

  /**
   * The slug comes from the address. Reading it from the auth store would
   * give the co-op the member last switched to, which on this page is a
   * link into a different co-op's event (UI-04 was this same mistake).
   */
  it('takes the co-op from the route, not from the session', () => {
    expect(PAGE).toContain("useParams().orgSlug");
  });

  /** Nothing to see for an event that sold none. */
  it('does not offer it where no tickets were sold', () => {
    expect(PAGE).toContain('row.ticketCount > 0 &&');
  });
});
