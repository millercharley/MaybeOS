import {
  MIN_PRICE_CENTS,
  actionLabel,
  isOpen,
  priceFromInput,
  priceLabel,
  priceToInput,
  scheduleLabel,
} from '@/lib/teaching';
import type { Offering } from '@/lib/api';
import { stripComments } from './helpers/source-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const offering = (over: Partial<Offering> = {}): Offering =>
  ({
    id: 'o1',
    orgId: 'org-1',
    kind: 'WORKSHOP',
    title: 'Wheel throwing',
    slug: 'wheel-throwing',
    visibility: 'MEMBERS_ONLY',
    payment: 'ARRANGE_DIRECTLY',
    isPublished: true,
    teacher: { name: 'Ada' },
    ...over,
  }) as Offering;

/**
 * Reading a typed price (TCH-01).
 *
 * The interesting part is what counts as wrong. `null` already means "free",
 * which is a real answer, so a parser that returns it for unparseable text
 * makes "forty quid" silently free — which is the one failure here that
 * costs somebody money.
 */
describe('a price somebody typed', () => {
  it('reads the ordinary case', () => {
    expect(priceFromInput('40')).toBe(4000);
    expect(priceFromInput('40.00')).toBe(4000);
    expect(priceFromInput('7.50')).toBe(750);
  });

  it('accepts what people actually type', () => {
    expect(priceFromInput('$40')).toBe(4000);
    expect(priceFromInput(' 1,200.00 ')).toBe(120000);
  });

  it('reads an empty box as free, which is a real answer', () => {
    expect(priceFromInput('')).toBeNull();
    expect(priceFromInput('   ')).toBeNull();
  });

  /** The one that would quietly cost somebody money. */
  it.each(['forty quid', 'free-ish', '40.123', '-5', 'NaN', '4e3'])(
    'refuses %s rather than calling it free',
    (input) => {
      expect(priceFromInput(input)).toBe('invalid');
    },
  );

  /** Stripe will not take a payment under fifty cents, so zero is not a price. */
  it('refuses anything under the floor Stripe sets', () => {
    expect(MIN_PRICE_CENTS).toBe(50);
    expect(priceFromInput('0')).toBe('invalid');
    expect(priceFromInput('0.49')).toBe('invalid');
    expect(priceFromInput('0.50')).toBe(50);
  });

  it('rounds rather than truncating', () => {
    // 19.99 is exactly representable as neither; truncating loses a cent.
    expect(priceFromInput('19.99')).toBe(1999);
  });

  it('goes back into a field unchanged', () => {
    expect(priceToInput(4000)).toBe('40.00');
    expect(priceToInput(null)).toBe('');
    expect(priceToInput(undefined)).toBe('');
  });
});

/**
 * What an offering costs, in a sentence. The order is the content: a
 * teacher's own words beat a number, because "pay what you can" is the answer
 * and `$0.00` is not.
 */
describe('what it costs, in words', () => {
  it('prefers the teacher’s own words to any number', () => {
    expect(
      priceLabel(offering({ priceNote: 'Sliding scale', priceCents: 4000 })),
    ).toBe('Sliding scale');
  });

  it('shows a price when MaybeOS is taking the money', () => {
    expect(priceLabel(offering({ payment: 'THROUGH_MAYBEOS', priceCents: 4000 }))).toBe(
      '$40.00',
    );
  });

  it('says free out loud rather than showing a zero', () => {
    expect(priceLabel(offering())).toBe('Free');
  });

  it('does not call a lesson free just because no number was given', () => {
    expect(priceLabel(offering({ kind: 'PRIVATE_LESSON' }))).toBe('Ask about rates');
  });

  it('ignores a price on something that is not selling tickets', () => {
    // ARRANGE_DIRECTLY with a stale priceCents on it must not quote one.
    expect(priceLabel(offering({ priceCents: 4000 }))).toBe('Free');
  });
});

/**
 * A workshop with no dates is a state the product has a name for, not a gap
 * it apologises for — Charley asked for it: "not required if just gathering
 * interest or sign ups".
 */
describe('what the schedule says', () => {
  it('calls an empty workshop what it is', () => {
    expect(scheduleLabel(offering({ sessions: [] }))).toBe('Gathering interest');
    expect(scheduleLabel(offering())).toBe('Gathering interest');
  });

  it('never calls it unscheduled', () => {
    expect(scheduleLabel(offering())).not.toMatch(/unscheduled|no dates|missing/i);
  });

  it('counts the dates, and gets one right', () => {
    expect(scheduleLabel(offering({ sessions: [{} as never] }))).toBe('1 date');
    expect(scheduleLabel(offering({ sessions: [{}, {}, {}] as never }))).toBe('3 dates');
  });

  it('says a lesson is arranged rather than scheduled', () => {
    expect(scheduleLabel(offering({ kind: 'PRIVATE_LESSON' }))).toBe('Arranged with you');
  });
});

describe('whether anybody can still put their hand up', () => {
  it('is open when published and not closed', () => {
    expect(isOpen(offering())).toBe(true);
  });

  it('is shut once closed', () => {
    expect(isOpen(offering({ closedAt: '2026-11-01T00:00:00Z' }))).toBe(false);
  });

  it('is shut while it is a draft', () => {
    expect(isOpen(offering({ isPublished: false }))).toBe(false);
  });
});

/**
 * A workshop with dates sends somebody to the dates, where RSVPs and tickets
 * already live. Re-implementing either under an offering would be a second
 * way to do the same thing.
 */
describe('what the button says', () => {
  it('sends a dated workshop to its dates', () => {
    expect(actionLabel(offering({ sessions: [{} as never] }))).toBe('See the dates');
  });

  it('collects interest when there are no dates yet', () => {
    expect(actionLabel(offering({ sessions: [] }))).toBe("I'd come to this");
  });

  it('asks about lessons', () => {
    expect(actionLabel(offering({ kind: 'PRIVATE_LESSON' }))).toBe('Ask about lessons');
  });

  it('says so when it is closed, whatever kind it is', () => {
    for (const kind of ['WORKSHOP', 'PRIVATE_LESSON'] as const) {
      expect(actionLabel(offering({ kind, closedAt: '2026-11-01T00:00:00Z' }))).toBe(
        'No longer taking anybody',
      );
    }
  });
});

/**
 * The teaching screens, read as source (TCH-01).
 *
 * Two rules that live in a page rather than a function, so a scan is the only
 * way to hold them. Both were bugs before they were rules.
 */
describe('the teaching screens', () => {
  const page = (...parts: string[]) =>
    stripComments(readFileSync(join(__dirname, '..', 'app', '(app)', ...parts), 'utf8'));

  const detail = () => page('portal', '[orgSlug]', 'teaching', '[slug]', 'page.tsx');

  /**
   * A workshop's dates arrive oldest-first and include the ones that have
   * been. Listing them all put a live "RSVP" button on an evening that had
   * already happened.
   */
  it('shows only the dates still to come', () => {
    expect(detail()).toContain('hasEnded(session)');
  });

  /**
   * `hasEnded` rather than a comparison written here: it is the one place
   * that decides what past means, and it measures from the end, so an evening
   * in progress is not filed under history (EVT-49).
   */
  it('does not invent its own idea of past', () => {
    const source = detail();

    expect(source).toMatch(/from '@\/lib\/event-tabs'/);
    expect(source).not.toMatch(/new Date\([^)]*startTime\)\s*<\s*/);
    expect(source).not.toMatch(/\.isPast\b/);
  });

  /**
   * A session inherits its offering's audience on the server. A dropdown here
   * would be a members-only workshop whose dates went public because nobody
   * read it.
   */
  it('never asks a teacher to set a session’s visibility', () => {
    const scheduler = stripComments(
      readFileSync(
        join(__dirname, '..', 'components', 'teaching', 'session-scheduler.tsx'),
        'utf8',
      ),
    );

    expect(scheduler).not.toContain('visibility');
  });
});
