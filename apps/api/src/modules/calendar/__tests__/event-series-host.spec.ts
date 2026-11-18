import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../../common/testing/source-scan';
import { importedHost, seriesRoot } from '../past-host';

/**
 * An instance of a series arrives under the host the series already has
 * (CAL-15).
 *
 * Charley: "Events keep arriving under your account faster than they are
 * moved."
 *
 * He was right about the arithmetic. 115 events were moved to their real
 * hosts on 11 November and 34 more on 13 November, and the number filed
 * under him went *up*, 614 to 638, because the sync creates what it finds
 * under the account whose calendar it read (CAL-07).
 *
 * What the counting hid is that these are not hundreds of separate
 * evenings. MaybeItsFate's 799 imported events are 547 one-offs and 252
 * instances of 18 Google series, and the 107 still to come under his account
 * are five activities. One of them says the whole thing: "(Open House)
 * Members' Potluck", 45 instances — 32 moved to Rebecca Norton by hand, and
 * 13 that the sync added afterwards sitting back under him.
 *
 * So the treadmill is not that moving is slow. It is that moving a series
 * teaches the importer nothing.
 */
describe('reading a Google series out of an instance id', () => {
  it('finds the series an instance belongs to', () => {
    expect(seriesRoot('5ejqmurksehlj6n3cqlmv6t6eu_20261208T230000Z')).toBe(
      '5ejqmurksehlj6n3cqlmv6t6eu',
    );
  });

  it('is nothing for a one-off', () => {
    /*
      547 of MaybeItsFate's 799 imported events, and not one of their ids
      contains an underscore at all — so a one-off is never read as an
      instance of something.
    */
    expect(seriesRoot('p682gglv01028ft5451uhvk114')).toBeNull();
    expect(seriesRoot('')).toBeNull();
    expect(seriesRoot(null)).toBeNull();
  });

  it('wants the whole timestamp, not merely an underscore', () => {
    // An id that happens to carry an underscore is not a series.
    expect(seriesRoot('some_event')).toBeNull();
    expect(seriesRoot('some_20261208')).toBeNull();
    expect(seriesRoot('some_20261208T2300Z')).toBeNull();
  });

  it('keeps the series whole when the id has several underscores', () => {
    expect(seriesRoot('a_b_c_20261208T230000Z')).toBe('a_b_c');
  });
});

describe('whose event an imported instance is', () => {
  const FALLBACK = 'u-charley';
  const DEREK = 'u-derek';
  const DANA = 'u-dana';

  it('takes the series host when the address says nothing useful', () => {
    // The shared-calendar case, which is almost all of them: `personFor`
    // falls through to the creator, who is whoever filled the calendar in.
    expect(importedHost(FALLBACK, DEREK, FALLBACK)).toBe(DEREK);
  });

  it('lets this instance’s own organiser win', () => {
    /*
      A week somebody else is covering is a real thing a co-op does, and
      Google can say it: the instance gets its own organiser. The series
      must not overrule that.
    */
    expect(importedHost(DANA, DEREK, FALLBACK)).toBe(DANA);
  });

  it('falls back to the address when there is no series to learn from', () => {
    expect(importedHost(FALLBACK, null, FALLBACK)).toBe(FALLBACK);
    expect(importedHost(null, null, FALLBACK)).toBeNull();
  });

  it('still answers when the co-op has no organiser to fall back to', () => {
    expect(importedHost(null, DEREK, null)).toBe(DEREK);
    expect(importedHost(DANA, DEREK, null)).toBe(DANA);
  });
});

describe('what the importer does with it', () => {
  const src = readFileSync(join(__dirname, '..', 'calendar-import.service.ts'), 'utf8');
  const writeEvents = src.slice(
    src.indexOf('private async writeEvents'),
    src.indexOf('private async writeBookings'),
  );

  it('reads the series hosts once for the batch, not once per entry', () => {
    /*
      CAL-06: forty chunks each re-read a whole calendar, wrote 274 rows and
      stopped in the same place twice. A per-entry lookup here would be the
      same mistake in a new place.
    */
    expect(writeEvents).toMatch(/const seriesHosts = await this\.seriesHostsFor\(/);
    expect(src).toMatch(/private async seriesHostsFor\(/);
    expect(writeEvents).not.toMatch(/for \([\s\S]*?await this\.seriesHostsFor/);
  });

  it('inherits on create and never on update (CAL-14)', () => {
    /*
      The other direction of the bug this file already carries: a sync that
      writes a host on every pass takes back whatever an organiser set. So
      `inherited` is read into the create branch only — a series host
      propagating over an instance somebody deliberately reassigned would be
      CAL-14 again, wearing the opposite hat.
    */
    const create = writeEvents.slice(writeEvents.indexOf('create: {'), writeEvents.indexOf('update: {'));
    /*
      The update object alone, with its comments taken out. The fill below it
      is a separate statement and does name `hostId` — that is the whole
      point of it — and the docblock *inside* the update object quotes the
      line CAL-14 removed. A scan that matches a file's own prose about a bug
      proves nothing, which is what `stripComments` is for.
    */
    const code = stripComments(writeEvents);
    const update = code.slice(code.indexOf('update: {'), code.indexOf('if (host.hostId)'));

    expect(writeEvents).toMatch(/const inherited = seriesHosts\.get\(/);
    expect(create).toContain('...host');
    expect(update).not.toContain('hostId');
    expect(update).not.toContain('inherited');
  });

  it('puts the precedence in one pure place', () => {
    // Not three conditions spelled out at the call site, where the next
    // reader has to reconstruct which answer wins.
    expect(writeEvents).toMatch(/importedHost\(matched, inherited, fallbackId\)/);
  });

  it('never treats the fallback organiser as a series host', () => {
    // It is the answer that means "nobody told us". A rule that reads it as
    // evidence hands one person the whole calendar (SPC-25).
    const helper = src.slice(src.indexOf('private async seriesHostsFor'), src.indexOf('private async writeEvents'));
    expect(helper).toMatch(/sibling\.hostId === fallbackId/);
  });

  it('drops a series two members both hold', () => {
    // Same rule as `unambiguousNames`: a split series is an organiser's own
    // decision, and an import is not what should interpret it.
    const helper = src.slice(src.indexOf('private async seriesHostsFor'), src.indexOf('private async writeEvents'));
    expect(helper).toMatch(/seen\.get\(root\) !== sibling\.hostId \? null :/);
  });

  it('matches a series by its own prefix, not another series’ start', () => {
    const helper = src.slice(src.indexOf('private async seriesHostsFor'), src.indexOf('private async writeEvents'));
    expect(helper).toMatch(/startsWith: `\$\{root\}_`/);
  });
});
