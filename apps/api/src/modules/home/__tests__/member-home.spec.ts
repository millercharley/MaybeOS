import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../../../common/testing/source-scan';
import {
  MEMBER_HOME_SECTIONS,
  isUnavailable,
  settleSections,
  type SectionName,
} from '../member-home';
import { HomeService } from '../home.service';

const source = (...parts: string[]) =>
  stripComments(readFileSync(join(__dirname, '..', ...parts), 'utf8'));

describe('the sections of a member dashboard', () => {
  /*
    Pinned, because this list is a contract across the workspace boundary.

    The web app declares the same ten names on its `MemberHome` interface and
    nothing in either compiler connects the two. A section added here and not
    there renders nothing; added there and not here, it reads `undefined`. The
    next test checks they agree; this one makes a change to either of them
    deliberate.
  */
  it('are these ten, and no others', () => {
    expect([...MEMBER_HOME_SECTIONS]).toEqual([
      'stats',
      'joins',
      'bookings',
      'rsvps',
      'events',
      'spotlight',
      'doorPin',
      'teaching',
      'service',
      'ask',
    ]);
  });

  it('are the same ten the web app expects', () => {
    const api = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', 'web', 'lib', 'api.ts'),
      'utf8',
    );

    const body = stripComments(api).match(
      /export interface MemberHome \{([\s\S]*?)\n\}/,
    );
    expect(body).not.toBeNull();

    const declared = [...body![1].matchAll(/^\s{2}([A-Za-z]+):/gm)].map((m) => m[1]);

    expect(declared.sort()).toEqual([...MEMBER_HOME_SECTIONS].sort());
  });
});

describe('a section that fails does not empty the page', () => {
  const two: SectionName[] = ['stats', 'joins'];

  it('keeps what was answered and nulls what was not', () => {
    const { sections, failed } = settleSections(two, [
      { status: 'fulfilled', value: 'kept' },
      { status: 'rejected', reason: new Error('the door is down') },
    ]);

    expect(sections.stats).toBe('kept');
    expect(sections.joins).toBeNull();
    expect(failed.map((failure) => failure.name)).toEqual(['joins']);
    // The reason rides along, so the caller never re-reads `results`.
    expect((failed[0].reason as Error).message).toBe('the door is down');
  });

  it('reports nothing when everything answered', () => {
    const { failed } = settleSections(two, [
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
    ]);

    expect(failed).toEqual([]);
  });

  /*
    A section answering `null` is not a failure. `radar/ask` does it on most
    loads — no question to ask — and `members/spotlight` does it in a co-op of
    one. Both are ordinary, and the caller cannot tell them from a failure,
    which is why the log and the `failed` list exist separately.
  */
  it('does not treat a null answer as a failure', () => {
    const { sections, failed } = settleSections(['ask'], [
      { status: 'fulfilled', value: null },
    ]);

    expect(sections.ask).toBeNull();
    expect(failed).toEqual([]);
  });

  /*
    A co-op that does not use a feature is not a fault.

    `teaching.listForOrg` calls `requireEnabled`, which throws `Forbidden`
    when the switch is off — and most co-ops have it off. Without this the
    bundle would have logged a warning on every dashboard load in the product,
    which is exactly the noise D-046 exists to stop.
  */
  describe('telling "not here" from "broken"', () => {
    const refusal = (status: number) => ({ getStatus: () => status });

    it('reads a 403 as a feature this co-op does not use', () => {
      expect(isUnavailable(refusal(403))).toBe(true);
    });

    it.each([[404], [409], [500]])('reads a %i as a real failure', (status) => {
      expect(isUnavailable(refusal(status))).toBe(false);
    });

    /*
      The safe direction. A dropped connection or a Prisma error carries no
      status, and treating those as "not here" would swallow the failures this
      log exists to surface.
    */
    it.each([
      ['a plain error', new Error('socket hang up')],
      ['a string', 'nope'],
      ['null', null],
      ['undefined', undefined],
      ['an object with a status field but no method', { status: 403 }],
    ])('reads %s as a real failure', (_label, reason) => {
      expect(isUnavailable(reason)).toBe(false);
    });
  });

  it('refuses a result list that does not match its names', () => {
    expect(() =>
      settleSections(two, [{ status: 'fulfilled', value: 1 }]),
    ).toThrow(/2 sections but 1 results/);
  });
});

describe('the bundle composes, it does not reimplement', () => {
  /*
    The whole safety of OPS-46 rests on this.

    `events.service.ts` counts seats rather than RSVP rows (EVT-64),
    `counted-members.ts` decides who is a member (MEM-27), the door service
    owns its own reconciliation state. Every one of those is a rule somebody
    got wrong once. A query written here would be a second copy: correct the
    day it was written and wrong within a month, with no way to tell which
    copy a member was reading.
  */
  it('does not reach for Prisma itself', () => {
    const service = source('home.service.ts');

    expect(service).not.toMatch(/PrismaService/);
    expect(service).not.toMatch(/this\.prisma/);
  });

  /*
    `Promise.allSettled`, never `Promise.all`.

    Ten separate requests had one accidental virtue: a panel whose request
    failed drew nothing and the other nine were unaffected. `Promise.all`
    would turn one failing query — one co-op's door integration down, one
    malformed row — into a 500 for the whole dashboard, which is strictly
    worse than the fan-out this replaced.

    Verified by mutation: changing `allSettled` to `all` fails this.
  */
  it('settles its queries rather than awaiting them', () => {
    const service = source('home.service.ts');

    expect(service).toMatch(/Promise\.allSettled\(/);
    expect(service).not.toMatch(/Promise\.all\(/);
  });

  it('asks each service for exactly what its own route asks for', async () => {
    const calls: string[] = [];
    const record = (name: string) => (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`);
      return Promise.resolve(name);
    };

    const home = new HomeService(
      { memberStats: record('memberStats'), recentJoins: record('recentJoins') } as never,
      {
        listUserRsvps: record('listUserRsvps'),
        listPublicEvents: record('listPublicEvents'),
      } as never,
      { listUserBookings: record('listUserBookings') } as never,
      { spotlight: record('spotlight') } as never,
      { pinFor: record('pinFor') } as never,
      { myService: record('myService') } as never,
      { nextAsk: record('nextAsk') } as never,
      { listForOrg: record('listForOrg') } as never,
    );

    const sections = await home.memberHome(
      'org-1',
      { userId: 'user-1', isStaff: false },
      '2026-11-19T05:00:00.000Z',
    );

    expect(Object.keys(sections).sort()).toEqual([...MEMBER_HOME_SECTIONS].sort());

    // The member's own id, never a parameter the caller could have named, and
    // the org from the route — the SEC-04 rule that every read is re-scoped.
    expect(calls).toContain('memberStats("org-1")');
    expect(calls).toContain('recentJoins("org-1", "user-1")');
    expect(calls).toContain('listUserBookings("user-1", "org-1", "upcoming")');
    expect(calls).toContain('listUserRsvps("org-1", "user-1")');
    expect(calls).toContain('spotlight("org-1", "user-1")');
    expect(calls).toContain('pinFor("org-1", "user-1")');
    expect(calls).toContain('myService("org-1", "user-1")');
    expect(calls).toContain('nextAsk("org-1", "user-1")');
    expect(calls).toContain('listForOrg("org-1", {"userId":"user-1","isStaff":false})');

    /*
      The window is passed through and membership is asserted by the trailing
      `true`, which is the same thing the `events/visible` handler does and
      for the same reason: the guard proves the caller is a member, a query
      parameter does not.
    */
    expect(calls).toContain(
      'listPublicEvents("org-1", {"from":"2026-11-19T05:00:00.000Z","perPage":100}, true)',
    );
  });

  it('does not report a co-op that has teaching switched off', async () => {
    const ok = () => Promise.resolve('answered');
    const refused = () =>
      Promise.reject(
        Object.assign(new Error('This co-op is not using teaching offerings.'), {
          getStatus: () => 403,
        }),
      );

    const home = new HomeService(
      { memberStats: ok, recentJoins: ok } as never,
      { listUserRsvps: ok, listPublicEvents: ok } as never,
      { listUserBookings: ok } as never,
      { spotlight: ok } as never,
      { pinFor: ok } as never,
      { myService: ok } as never,
      { nextAsk: ok } as never,
      { listForOrg: refused } as never,
    );

    const warn = jest
      .spyOn((home as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);

    const sections = await home.memberHome('org-1', { userId: 'user-1', isStaff: false });

    // The panel gets nothing, as it would if the co-op had no offerings — and
    // the web side draws nothing at all when the switch is off.
    expect(sections.teaching).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('answers the other nine when one service throws', async () => {
    const ok = () => Promise.resolve('answered');
    const home = new HomeService(
      { memberStats: ok, recentJoins: ok } as never,
      { listUserRsvps: ok, listPublicEvents: ok } as never,
      { listUserBookings: ok } as never,
      { spotlight: ok } as never,
      { pinFor: () => Promise.reject(new Error('door offline')) } as never,
      { myService: ok } as never,
      { nextAsk: ok } as never,
      { listForOrg: ok } as never,
    );

    const sections = await home.memberHome('org-1', { userId: 'user-1', isStaff: false });

    expect(sections.doorPin).toBeNull();
    expect(sections.stats).toBe('answered');
    expect(sections.service).toBe('answered');
  });
});
