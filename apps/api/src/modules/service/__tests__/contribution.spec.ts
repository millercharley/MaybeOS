import { Test } from '@nestjs/testing';
import { ServiceService } from '../service.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * What members gave, for ImpactOS (SRV-02).
 *
 * This figure ends up in a grant application, so what it counts is the whole
 * of its correctness. Every test here is about something it must *not* do.
 */
describe('ServiceService.contribution', () => {
  let service: ServiceService;
  let prisma: any;

  const claim = (over: Record<string, unknown> = {}) => ({
    userId: 'user-1',
    minutes: 30,
    minutesEdited: false,
    duty: { id: 'duty-1', title: 'Take the bins out' },
    ...over,
  });

  const build = async (rate: number | null, claims: unknown[]) => {
    prisma = {
      organization: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ timezone: 'America/New_York', volunteerHourValueCents: rate }),
      },
      dutyClaim: { findMany: jest.fn().mockResolvedValue(claims) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ServiceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ServiceService);
    return service.contribution('org-1');
  };

  it('adds up hours across turns and members', async () => {
    const result = await build(null, [
      claim({ minutes: 90 }),
      claim({ userId: 'user-2', minutes: 30 }),
      claim({ userId: 'user-2', minutes: 60 }),
    ]);

    expect(result.totalMinutes).toBe(180);
    expect(result.totalHours).toBe(3);
    expect(result.turns).toBe(3);
    // Two people did three turns. A headcount of 3 would overstate the co-op.
    expect(result.members).toBe(2);
  });

  it('counts only turns actually marked done', async () => {
    // The query does the filtering, so this asserts the filter rather than the
    // arithmetic — a claimed Tuesday is a promise, and a promise is not a
    // contribution a co-op may report.
    await build(null, []);
    expect(prisma.dutyClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'DONE' }) }),
    );
  });

  it('reports no dollar value until the co-op sets a rate', async () => {
    const result = await build(null, [claim({ minutes: 600 })]);

    expect(result.totalHours).toBe(10);
    // Hours need no assumption to be true. A dollar figure is an assertion,
    // and MaybeOS must not make it on the co-op's behalf.
    expect(result.valueCents).toBeNull();
    expect(result.hourValueCents).toBeNull();
  });

  it("values hours at the co-op's own rate once it has one", async () => {
    const result = await build(3000, [claim({ minutes: 600 })]);

    expect(result.valueCents).toBe(30000); // 10 hours at $30
    // Echoed so a reader can see what produced the number.
    expect(result.hourValueCents).toBe(3000);
  });

  it('states a value that matches the hours it prints', async () => {
    // 165 minutes is 2.75 hours and prints as "2.8". Valuing the exact 2.75
    // gave $77.00 against a report saying "2.8 hours at $28.00" — so anybody
    // doing the multiplication got $78.40 and a reason to distrust the
    // document. The hours are estimates to a tenth; the arithmetic is not.
    const result = await build(2800, [claim({ minutes: 90 }), claim({ minutes: 75 })]);

    expect(result.totalMinutes).toBe(165);
    expect(result.totalHours).toBe(2.8);
    expect(result.valueCents).toBe(Math.round(result.totalHours * 2800));
    expect(result.valueCents).toBe(7840);
  });

  it('keeps hours times rate exactly equal to the value, at any size', async () => {
    // The property, not one example: this is what a reader checks.
    for (const minutes of [5, 25, 47, 165, 619, 1441, 100_000]) {
      const result = await build(1750, [claim({ minutes })]);
      expect(result.valueCents).toBe(Math.round(result.totalHours * 1750));
    }
  });

  it('never returns who served, only how many', async () => {
    const result = await build(null, [claim(), claim({ userId: 'user-2' })]);

    // This feeds a document that leaves the co-op.
    expect(JSON.stringify(result)).not.toContain('user-1');
    expect(result.members).toBe(2);
  });

  it('says how much of the total is a corrected figure', async () => {
    const result = await build(null, [
      claim({ minutes: 30 }),
      claim({ minutes: 120, minutesEdited: true }),
    ]);

    // The honest measure of how much is estimate and how much is somebody's
    // account of what happened — what a careful funder would ask.
    expect(result.correctedTurns).toBe(1);
  });

  it('counts a turn on the day it happened, not the day it was recorded', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-12-31');
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC', volunteerHourValueCents: null }),
      },
      dutyClaim: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [ServiceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    await moduleRef.get(ServiceService).contribution('org-1', from, to);

    // `occursAt`, not `completedAt`: a member catching up on paperwork in
    // January must not move hours into the wrong reporting year.
    const { where } = prisma.dutyClaim.findMany.mock.calls[0][0];
    expect(where.occursAt).toEqual({ gte: from, lte: to });
    expect(where.completedAt).toBeUndefined();
  });

  it('rounds hours to one place rather than implying false precision', async () => {
    // 25 minutes is 0.4166… hours, and four decimal places would read as
    // precision the underlying estimate cannot support.
    const result = await build(null, [claim({ minutes: 25 })]);
    expect(result.totalHours).toBe(0.4);
  });

  it('breaks the total down by duty, largest first', async () => {
    const result = await build(null, [
      claim({ minutes: 30 }),
      claim({ minutes: 240, duty: { id: 'duty-2', title: 'Open the space on Saturdays' } }),
    ]);

    expect(result.byDuty.map((d) => d.title)).toEqual([
      'Open the space on Saturdays',
      'Take the bins out',
    ]);
    expect(result.byDuty[0].hours).toBe(4);
  });
});
