import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The organiser's list returns what its cards read (EVT-35, SPC-26).
 *
 * EVT-35 shipped a card that names the host, counts ticket sales and — with
 * SPC-26 — lists the rooms, and the query that feeds it fetched none of
 * those. Every card would have said "No host set" and no ticket line would
 * ever have appeared.
 *
 * The web tests passed, because they read the web source. Nothing compared
 * the two sides, which is exactly the shape of the cursor bug in CAL-08: both
 * halves correct on their own and wrong together.
 */

const service = readFileSync(join(__dirname, '..', 'events.service.ts'), 'utf8');

/** The body of `listByOrg`, which is what the organiser's console calls. */
const listByOrg = (() => {
  const start = service.indexOf('async listByOrg(');
  const end = service.indexOf('/* ─── ', start);
  return service.slice(start, end);
})();

describe('what the organiser’s event list fetches', () => {
  it('fetches the host, which the card names', () => {
    expect(listByOrg).toMatch(/host: \{ select: \{ id: true, name: true/);
  });

  it('fetches the co-hosts, which the card counts', () => {
    expect(listByOrg).toMatch(/coHosts: \{/);
  });

  it('fetches the rooms it holds', () => {
    expect(listByOrg).toMatch(/rooms: \{/);
  });

  it('fetches the ticket count, not counting refunds', () => {
    expect(listByOrg).toMatch(/_count: \{ select: \{ tickets: \{ where: \{ refundedAt: null \} \} \} \}/);
  });

  it('flattens that count into the shape a card reads', () => {
    expect(listByOrg).toMatch(/ticketsSold: _count\?\.tickets \?\? 0/);
  });
});

describe('what the organiser’s event detail fetches', () => {
  const detail = (() => {
    const start = service.indexOf('async findOne(');
    return start === -1 ? service : service.slice(start, start + 4000);
  })();

  it('fetches the rooms it holds', () => {
    expect(detail).toMatch(/rooms: \{/);
  });
});
