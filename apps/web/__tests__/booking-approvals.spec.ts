import { readFileSync } from 'fs';
import { join } from 'path';
import { approvalSummary, awaitingCount, whenLabel } from '@/lib/booking-approvals';
import type { PendingBooking } from '@/lib/api';

/**
 * Room requests waiting on an organiser (SPC-32).
 *
 * Charley: "where do I see a room reservation request for a room that needs an
 * admin approval?" Nowhere. Approve and reject have worked since SpaceOS was
 * built and nothing ever called them, so a room with `requiresApproval`
 * collected requests that existed only in the database — MaybeItsFate had
 * three, one a launch party booked that morning with the gallery held for it.
 */
const req = (over: Partial<PendingBooking> = {}): PendingBooking => ({
  id: 'b1',
  title: 'Podcast Launch Party',
  startTime: '2026-10-20T21:00:00.000Z',
  endTime: '2026-10-21T00:00:00.000Z',
  createdAt: '2026-10-08T16:44:51.000Z',
  room: { id: 'r1', name: 'Main Gallery' },
  user: { id: 'u1', name: 'Rebecca Norton' },
  lapsed: false,
  ...over,
});

describe('counting what is waiting', () => {
  it('counts only the ones still worth answering', () => {
    /*
      A request for a date that has passed stays on the list — somebody was
      left waiting and that should be visible — but approving it changes
      nothing for anybody, so it does not belong in a count demanding
      attention.
    */
    expect(awaitingCount([req(), req({ id: 'b2', lapsed: true })])).toBe(1);
  });
});

describe('the heading', () => {
  it('says how many are waiting', () => {
    expect(approvalSummary([req()])).toBe('1 room request waiting on you');
    expect(approvalSummary([req(), req({ id: 'b2' })])).toBe('2 room requests waiting on you');
  });

  it('mentions the ones that already passed, without counting them as live', () => {
    expect(approvalSummary([req(), req({ id: 'b2', lapsed: true })])).toBe(
      '1 room request waiting on you, and 1 that already passed',
    );
  });

  it('says plainly when every one of them went unanswered', () => {
    // The evidence of the failure this screen exists to end.
    expect(approvalSummary([req({ lapsed: true }), req({ id: 'b2', lapsed: true })])).toBe(
      '2 room requests went unanswered',
    );
  });
});

describe('when the room is wanted', () => {
  it('reads as a day and a span', () => {
    expect(whenLabel({ startTime: '2026-10-20T21:00:00.000Z', endTime: '2026-10-21T00:00:00.000Z' }))
      .toMatch(/Tue, 20 Oct|Oct 20/);
  });

  it('survives a date the API sent back malformed', () => {
    expect(whenLabel({ startTime: 'nonsense', endTime: 'nonsense' })).toBe('');
  });
});

describe('the queue', () => {
  const strip = (s: string) =>
    s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const panel = strip(readFileSync(join(__dirname, '..', 'components', 'rooms', 'booking-approvals.tsx'), 'utf8'));
  const page = strip(
    readFileSync(
      join(__dirname, '..', 'app', '(app)', '(dashboard)', 'admin', '[orgSlug]', 'rooms', 'page.tsx'),
      'utf8',
    ),
  );
  const client = strip(readFileSync(join(__dirname, '..', 'lib', 'api.ts'), 'utf8'));

  it('is on the rooms page, above everything else', () => {
    // An approval queue is only useful if it is in the way.
    expect(page).toMatch(/<BookingApprovals orgId=\{orgId\} \/>/);
    expect(page.indexOf('BookingApprovals')).toBeLessThan(page.indexOf('{notice &&'));
  });

  it('offers both answers', () => {
    expect(panel).toMatch(/api\.rooms\.approveBooking\(/);
    expect(panel).toMatch(/api\.rooms\.rejectBooking\(/);
  });

  it('calls the path the API actually serves', () => {
    /*
      Both wrappers built `/orgs/:orgId/rooms/:roomId/bookings/:id/approve`,
      which has never existed — the route is `/orgs/:orgId/bookings/:id/approve`
      — so a button wired to the old wrapper would have answered 404. The
      missing screen was not the only thing wrong.
    */
    expect(client).toMatch(/approveBooking: \(orgId: string, bookingId: string, token: string\)/);
    expect(client).toMatch(/`\/orgs\/\$\{orgId\}\/bookings\/\$\{bookingId\}\/approve`/);
    expect(client).not.toMatch(/rooms\/\$\{roomId\}\/bookings\/\$\{bookingId\}\/approve/);
  });

  it('says the room is being held, which is why this is urgent', () => {
    expect(panel).toMatch(/held until you decide/);
  });

  it('stays out of the way when there is nothing to do', () => {
    // A panel saying "nothing waiting" every day is furniture.
    expect(panel).toMatch(/pending\.length === 0\) return null/);
  });

  it('reloads from the server after a decision', () => {
    // Rather than splicing the row out and trusting it worked.
    expect(panel).toMatch(/await load\(\);/);
  });
});
