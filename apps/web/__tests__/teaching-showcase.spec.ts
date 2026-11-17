import { showcaseOfferings } from '@/lib/teaching';
import type { Offering } from '@/lib/api';

const NOW = new Date('2026-11-17T12:00:00.000Z');

let n = 0;
const offering = (over: Partial<Offering> = {}): Offering =>
  ({
    id: `o${(n += 1)}`,
    orgId: 'org-1',
    kind: 'WORKSHOP',
    title: `Offering ${n}`,
    slug: `offering-${n}`,
    visibility: 'MEMBERS_ONLY',
    payment: 'ARRANGE_DIRECTLY',
    isPublished: true,
    teacher: { name: 'Ada' },
    sessions: [],
    ...over,
  }) as Offering;

const session = (start: string, end: string) =>
  ({ startTime: start, endTime: end }) as never;

const titles = (list: Offering[]) => list.map((o) => o.title);

/**
 * What the dashboard showcase picks (TCH-03).
 *
 * The list it is handed is the co-op's own, which carries drafts for an
 * organiser and a teacher's own drafts for everybody. Neither belongs on a
 * panel that says "here is what people are teaching".
 */
describe('choosing what to showcase', () => {
  it('shows a published offering', () => {
    const list = showcaseOfferings([offering({ title: 'Wheel throwing' })], { now: NOW });

    expect(titles(list)).toEqual(['Wheel throwing']);
  });

  /** The one that would publish somebody's half-written workshop. */
  it('never shows a draft', () => {
    const list = showcaseOfferings(
      [offering({ title: 'Half written', isPublished: false }), offering({ title: 'Ready' })],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Ready']);
  });

  /**
   * Absent means absent, not "probably fine". A read that does not carry
   * `isPublished` should show less, never more.
   */
  it('does not assume published when nobody said', () => {
    const list = showcaseOfferings([offering({ isPublished: undefined })], { now: NOW });

    expect(list).toEqual([]);
  });

  it('drops one that has stopped taking anybody', () => {
    const list = showcaseOfferings(
      [offering({ title: 'Closed', closedAt: '2026-11-01T00:00:00Z' }), offering({ title: 'Open' })],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Open']);
  });

  it('shows at most three, and takes a different limit', () => {
    const many = Array.from({ length: 6 }, () => offering());

    expect(showcaseOfferings(many, { now: NOW })).toHaveLength(3);
    expect(showcaseOfferings(many, { now: NOW, limit: 2 })).toHaveLength(2);
  });
});

/**
 * Ranked by what a member can act on. Something happening next week beats an
 * invitation to register interest.
 */
describe('the order it shows them in', () => {
  it('puts the soonest date first', () => {
    const list = showcaseOfferings(
      [
        offering({
          title: 'Later',
          sessions: [session('2026-12-20T18:00:00Z', '2026-12-20T20:00:00Z')],
        }),
        offering({
          title: 'Sooner',
          sessions: [session('2026-11-20T18:00:00Z', '2026-11-20T20:00:00Z')],
        }),
      ],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Sooner', 'Later']);
  });

  it('puts anything with a date ahead of anything gathering interest', () => {
    const list = showcaseOfferings(
      [
        offering({ title: 'Gathering interest' }),
        offering({
          title: 'Dated',
          sessions: [session('2026-12-20T18:00:00Z', '2026-12-20T20:00:00Z')],
        }),
      ],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Dated', 'Gathering interest']);
  });

  /**
   * A workshop whose dates have all been is not upcoming, and must not win
   * the top slot by having the smallest number on it.
   */
  it('ignores dates that have already happened', () => {
    const list = showcaseOfferings(
      [
        offering({
          title: 'All in the past',
          sessions: [session('2026-01-05T18:00:00Z', '2026-01-05T20:00:00Z')],
        }),
        offering({
          title: 'Still to come',
          sessions: [session('2026-12-20T18:00:00Z', '2026-12-20T20:00:00Z')],
        }),
      ],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Still to come', 'All in the past']);
  });

  /**
   * Measured from the end: an evening that started an hour ago and runs for
   * another hour is tonight's, not history (EVT-49).
   */
  it('counts an evening in progress as still to come', () => {
    const list = showcaseOfferings(
      [
        offering({
          title: 'Next week',
          sessions: [session('2026-11-24T18:00:00Z', '2026-11-24T20:00:00Z')],
        }),
        offering({
          title: 'On right now',
          sessions: [session('2026-11-17T11:00:00Z', '2026-11-17T13:00:00Z')],
        }),
      ],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['On right now', 'Next week']);
  });

  it('uses the soonest of several dates, not the first in the list', () => {
    const list = showcaseOfferings(
      [
        offering({
          title: 'Two dates',
          sessions: [
            session('2026-12-20T18:00:00Z', '2026-12-20T20:00:00Z'),
            session('2026-11-19T18:00:00Z', '2026-11-19T20:00:00Z'),
          ],
        }),
        offering({
          title: 'One date',
          sessions: [session('2026-11-25T18:00:00Z', '2026-11-25T20:00:00Z')],
        }),
      ],
      { now: NOW },
    );

    expect(titles(list)).toEqual(['Two dates', 'One date']);
  });

  /** No dates anywhere: the API's own order stands, and does not shuffle. */
  it('keeps the order it was given when nothing has a date', () => {
    const given = [offering({ title: 'First' }), offering({ title: 'Second' })];

    expect(titles(showcaseOfferings(given, { now: NOW }))).toEqual(['First', 'Second']);
    expect(titles(showcaseOfferings(given, { now: NOW }))).toEqual(['First', 'Second']);
  });

  it('is happy with nothing at all', () => {
    expect(showcaseOfferings([], { now: NOW })).toEqual([]);
  });
});
