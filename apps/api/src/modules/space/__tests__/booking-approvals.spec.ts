import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Telling somebody a room is being asked for (SPC-32).
 *
 * The 'received' email has always gone to `b.user.email` — the member who made
 * the request. So a request arrived, the member was told an organiser would
 * look at it, and no organiser was told anything. MaybeItsFate had three
 * waiting, one a launch party booked that morning with the gallery held.
 */
const service = readFileSync(
  join(__dirname, '..', 'space.service.ts'),
  'utf8',
);
const controller = readFileSync(join(__dirname, '..', 'space.controller.ts'), 'utf8');

describe('when a request needs approving', () => {
  it('tells the organisers, not only the member', () => {
    expect(service).toMatch(/if \(status === 'PENDING'\) await this\.tellOrganisersOfRequest\(/);
    expect(service).toMatch(/role: \{ in: \['ADMIN', 'STAFF'\] \}/);
  });

  it('is never allowed to fail the booking', () => {
    /*
      The member has made their request and the room is held either way. A mail
      server having a bad afternoon must not turn that into an error on their
      screen — the same rule every other notification here follows.
    */
    const fn = service.slice(service.indexOf('private async tellOrganisersOfRequest'));
    expect(fn.slice(0, 2600)).toMatch(/try \{/);
    expect(fn.slice(0, 2600)).toMatch(/catch \(err\)/);
  });

  it('says how many are waiting, so the email knows if it is a pile', () => {
    expect(service).toMatch(/status: 'PENDING', endTime: \{ gte: new Date\(\) \}/);
  });

  it('has no way to fire for a room that approves on its own', () => {
    /*
      Stated as "there is exactly one call site and it is the guarded one",
      rather than as the absence of some particular unguarded spelling — a
      `not.toMatch` passes for every reason including the ones nobody thought
      of, which is how a test ends up proving nothing.
    */
    const calls = service.match(/this\.tellOrganisersOfRequest\(/g) ?? [];
    const guarded = service.match(/if \(status === 'PENDING'\) await this\.tellOrganisersOfRequest\(/g) ?? [];

    expect(calls).toHaveLength(1); // one call site; the declaration carries no `this.`
    expect(guarded).toHaveLength(1);
  });
});

describe('the queue behind the screen', () => {
  it('is organisers only', () => {
    const route = controller.slice(controller.indexOf("@Get('bookings/pending')"));
    expect(route.slice(0, 200)).toMatch(/@Roles\('ADMIN', 'STAFF'\)/);
  });

  it('is declared before any route that would swallow it', () => {
    // `bookings/pending` under a `bookings/:id` would never be reached.
    const pending = controller.indexOf("@Get('bookings/pending')");
    const byId = controller.indexOf("@Get('bookings/:bookingId')");
    expect(pending).toBeGreaterThan(-1);
    expect(byId === -1 || pending < byId).toBe(true);
  });

  it('answers soonest first', () => {
    // Thursday's request needs answering before March's, whatever order they
    // were asked in.
    const fn = service.slice(service.indexOf('async listPendingBookings'));
    expect(fn.slice(0, 900)).toMatch(/orderBy: \{ startTime: 'asc' \}/);
  });

  it('keeps the ones that already passed, marked rather than dropped', () => {
    /*
      A request for last Tuesday that nobody answered is not clutter — it is a
      member who was left waiting, and hiding it would hide the evidence of
      exactly the failure this fixes.
    */
    const fn = service.slice(service.indexOf('async listPendingBookings'));
    expect(fn.slice(0, 1400)).toMatch(/lapsed: row\.endTime < now/);
    expect(fn.slice(0, 1400)).not.toMatch(/endTime: \{ gte/);
  });

  it('is scoped to the co-op', () => {
    const fn = service.slice(service.indexOf('async listPendingBookings'));
    expect(fn.slice(0, 900)).toMatch(/where: \{ room: \{ orgId \}, status: 'PENDING' \}/);
  });
});
