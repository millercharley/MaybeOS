import { cancelledId, toEntry } from '../calendar-import';

/**
 * A deleted Google entry has to let the room go (CAL-12).
 *
 * Charley removed an event from the Attic's Google calendar and MaybeOS went
 * on showing the Attic as booked. The import's own documentation said a
 * cancelled entry "unpublishes what it created before"; the code skipped it
 * and did nothing else — and underneath that, Google was never asked for
 * deleted rows at all, so the entry did not arrive cancelled. It did not
 * arrive.
 */
describe('reading a deletion', () => {
  it('takes the id off a row Google reports as cancelled', () => {
    expect(cancelledId({ id: 'abc123', status: 'cancelled' })).toBe('abc123');
  });

  it('ignores a row that is still happening', () => {
    expect(cancelledId({ id: 'abc123', status: 'confirmed' })).toBeNull();
  });

  it('ignores a cancelled row with no id, which names no booking', () => {
    expect(cancelledId({ status: 'cancelled' })).toBeNull();
  });

  it('reads a cancelled row that carries nothing but an id and a status', () => {
    /*
      Why this is its own function rather than part of `toEntry`.

      A deleted instance usually arrives with no start, no end and no summary.
      `toEntry` answers null for anything without a start — correctly, since it
      is not an importable thing — which threw away the one field that says
      which booking to release.
    */
    const deleted = { id: 'abc123', status: 'cancelled' };

    expect(toEntry(deleted as never, 'America/New_York')).toBeNull();
    expect(cancelledId(deleted)).toBe('abc123');
  });

  it('reads a recurring instance’s own id, not the series’', () => {
    // `singleEvents: true` gives each occurrence its own id, and that is the
    // id the booking was created with — so one deleted Tuesday releases one
    // Tuesday.
    expect(
      cancelledId({ id: 'series123_20261011T180000Z', status: 'cancelled' }),
    ).toBe('series123_20261011T180000Z');
  });
});

describe('the request that asks for them', () => {
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'calendar-import.service.ts'),
    'utf8',
  );

  it('asks Google for deleted rows, on both reads', () => {
    // Without this they are omitted, and the deletion is invisible rather
    // than merely unhandled. Both the paged read and the preview read.
    const asks = source.match(/showDeleted: true/g) ?? [];
    expect(asks.length).toBe(2);
  });

  it('frees the slot by status, which is what availability reads', () => {
    // `canceledAt` alone would have left the room exactly as booked: the
    // availability query filters on `status` and never looks at the timestamp.
    expect(source).toMatch(/data: \{ status: 'CANCELED', canceledAt: new Date\(\) \}/);
  });

  it('does not restamp something already cancelled', () => {
    expect(source).toMatch(/status: \{ not: 'CANCELED' \}/);
  });

  it('keeps the event, marking it cancelled rather than deleting it', () => {
    // People may have RSVPed. A co-op's record of what it ran should not
    // vanish because a calendar row did.
    expect(source).toMatch(/prisma\.event\.updateMany\(\{[\s\S]{0,200}canceledAt: new Date\(\)/);
  });

  it('tells the admin when something was let go', () => {
    // The one number in an import that takes something away.
    expect(source).toMatch(/released: cancelled/);
  });
});
