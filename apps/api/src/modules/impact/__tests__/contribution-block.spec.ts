import { ReportService as RS } from '../report.service';
import { COMPOSABLE_KINDS } from '../report-composer';
import { groundedNumbers, numeralsIn } from '../report-validation';

/**
 * The contribution section of an impact report (SRV-02).
 *
 * This block is the one place service hours become a claim a co-op makes to a
 * funder, so the tests are about what it refuses to say: no dollar figure
 * without a rate, no rate without saying whose it is, and no hidden estimate.
 */
const NO_SIGNALS = { goals: [], members: 12, suppressionThreshold: 5, windows: [] };
const NO_SPEND = {
  totalCents: 0,
  byCategory: [],
  byGoal: [],
  attributedShare: null,
  expenseCount: 0,
};

const contribution = (over: Record<string, unknown> = {}) => ({
  timezone: 'UTC',
  turns: 24,
  totalMinutes: 1440,
  totalHours: 24,
  members: 6,
  hourValueCents: null,
  valueCents: null,
  correctedTurns: 0,
  byDuty: [{ dutyId: 'd1', title: 'Take the bins out', turns: 24, minutes: 1440, hours: 24 }],
  ...over,
});

const compose = (over: Record<string, unknown> = {}) =>
  (RS.prototype as any).composeBlocks.call(
    {},
    {
      org: { name: 'Sunrise', mission: null },
      signals: NO_SIGNALS,
      spend: NO_SPEND,
      contribution: contribution(over),
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
      tier: 'WRITTEN',
    },
  );

const blockOf = (over: Record<string, unknown> = {}) =>
  compose(over).find((b: any) => b.kind === 'contribution');

describe('the contribution block', () => {
  it('reports hours and people, not names', () => {
    const block = blockOf();

    expect(block.heading).toBe('What members gave');
    expect(block.body).toContain('6 members gave 24 hours');
    expect(block.body).toContain('24 turns on the rota');
  });

  it('says nothing about money when the co-op has set no rate', () => {
    const body = blockOf().body;

    // The failure this guards: a report quietly valuing volunteer time at a
    // figure nobody in the co-op chose.
    expect(body).not.toMatch(/\$/);
    expect(blockOf().data.valueCents).toBeNull();
  });

  it('names the rate as the co-op’s own when there is one', () => {
    const body = blockOf({ hourValueCents: 3000, valueCents: 72000 }).body;

    expect(body).toContain('$720.00');
    expect(body).toContain('$30.00 an hour');
    // Unattributed, "$720 of volunteer value" invites a reader to assume a
    // standard behind it, and there is not one.
    expect(body).toContain("co-op's own");
    expect(body).toContain('MaybeOS does not supply one');
  });

  it('always says only completed turns count, and when they counted', () => {
    const body = blockOf().body;

    expect(body).toContain('marked done');
    expect(body).toContain('the day the turn');
  });

  it('says the figure is an estimate when nobody corrected anything', () => {
    expect(blockOf().body).toContain("the co-op's own estimate");
  });

  it('says how many were corrected when some were', () => {
    const body = blockOf({ correctedTurns: 5 }).body;

    expect(body).toContain('5 of these were timed by the member');
    expect(body).toContain("the rest are the co-op's estimate");
    expect(body).not.toContain("Every figure is the co-op's own estimate");
  });

  it('does not claim a "rest" when every turn was corrected', () => {
    // Found in a real generated report: "2 of these were corrected... the rest
    // are the estimate" against 2 turns in total. There was no rest.
    const body = blockOf({ turns: 2, correctedTurns: 2 }).body;

    expect(body).toContain('Every turn was timed by the member who did it');
    expect(body).not.toContain('the rest');
  });

  it('is omitted entirely when nobody served', () => {
    // A heading over a zero reads as a co-op whose members did nothing, when
    // in fact it has no rota.
    expect(blockOf({ totalMinutes: 0, totalHours: 0, turns: 0, members: 0 })).toBeUndefined();
  });

  it('is composable, so the caveat can be written well', () => {
    expect(COMPOSABLE_KINDS.has('contribution')).toBe(true);
  });

  it('grounds every number it prints, so the composer may reuse them', () => {
    // The validator rejects any numeral in composed prose that is not derived
    // from the block's own data. A figure in the body but not in `data` would
    // make the deterministic text unrewritable.
    const block = blockOf({ hourValueCents: 3000, valueCents: 72000 });
    const allowed = groundedNumbers(block.data);

    for (const numeral of numeralsIn(block.body)) {
      expect(allowed.has(numeral)).toBe(true);
    }
  });
});

describe('the spending block', () => {
  it('is omitted when there was no spending', () => {
    expect(compose().find((b: any) => b.kind === 'spend')).toBeUndefined();
  });
});
