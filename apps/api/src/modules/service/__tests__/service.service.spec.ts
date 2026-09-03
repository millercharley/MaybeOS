import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ServiceService } from '../service.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The rules a service rota has to hold (SRV-01).
 *
 * Most of these are refusals, and every one of them is a way the hours become
 * untrue — which matters more here than in most features, because a tier can
 * hang a membership requirement off the total.
 */
describe('ServiceService', () => {
  let service: ServiceService;
  let prisma: any;

  const TUESDAY_DUTY = {
    id: 'duty-1',
    orgId: 'org-1',
    title: 'Take the bins out',
    estimatedMinutes: 30,
    capacity: 1,
    requiresApproval: false,
    recurrence: 'WEEKLY',
    // Tue 8 Sep 2026, midday NY — stored as an instant, read as a local date.
    startsOn: new Date('2026-09-08T16:00:00.000Z'),
    endsOn: null,
    startTime: '08:00',
    isActive: true,
  };

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }),
      },
      duty: {
        findFirst: jest.fn().mockResolvedValue(TUESDAY_DUTY),
        findMany: jest.fn().mockResolvedValue([TUESDAY_DUTY]),
        update: jest.fn().mockImplementation(({ data }) => ({ ...TUESDAY_DUTY, ...data })),
        delete: jest.fn().mockResolvedValue(TUESDAY_DUTY),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'new', ...data })),
      },
      dutyClaim: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'claim-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'claim-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      dutyAdoption: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'adopt-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'adopt-1', ...data })),
      },
      userOrg: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: any) => fn(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [ServiceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(ServiceService);
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T15:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  describe('claiming a turn', () => {
    it('takes the dates asked for', async () => {
      const result = await service.claim('org-1', 'user-1', 'duty-1', {
        dates: ['2026-09-08', '2026-09-15'],
      });
      expect(result.claimed).toEqual(['2026-09-08', '2026-09-15']);
      expect(prisma.dutyClaim.create).toHaveBeenCalledTimes(2);
    });

    it('refuses a date the duty does not fall on', async () => {
      // A Wednesday for a Tuesday duty. Without this the row exists, counts
      // toward nobody's coverage, and can never be seen on a calendar again.
      await expect(
        service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-09'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.dutyClaim.create).not.toHaveBeenCalled();
    });

    it('refuses a date that has already passed', async () => {
      await expect(
        service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-08-25'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses when the turn is already covered', async () => {
      prisma.dutyClaim.count.mockResolvedValue(1); // capacity is 1
      await expect(
        service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-08'] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('checks capacity inside a transaction', async () => {
      // Two members clicking the last slot at once both read "one left"
      // otherwise, and both get it.
      await service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-08'] });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('leaves a gated duty waiting on an organiser', async () => {
      prisma.duty.findFirst.mockResolvedValue({ ...TUESDAY_DUTY, requiresApproval: true });
      await service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-08'] });
      expect(prisma.dutyClaim.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CLAIMED' }) }),
      );
    });

    it('confirms outright when the duty is not gated', async () => {
      await service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-08'] });
      expect(prisma.dutyClaim.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED' }) }),
      );
    });

    it('reuses a turn handed back rather than writing a second row', async () => {
      prisma.dutyClaim.findFirst.mockResolvedValue({ id: 'old', status: 'RELEASED' });
      await service.claim('org-1', 'user-1', 'duty-1', { dates: ['2026-09-08'] });
      expect(prisma.dutyClaim.create).not.toHaveBeenCalled();
      expect(prisma.dutyClaim.update).toHaveBeenCalled();
    });
  });

  describe('taking a duty on standing', () => {
    it('refuses to adopt a one-off', async () => {
      prisma.duty.findFirst.mockResolvedValue({ ...TUESDAY_DUTY, recurrence: 'NONE' });
      await expect(service.adopt('org-1', 'user-1', 'duty-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('refuses a second standing claim on the same duty', async () => {
      prisma.dutyAdoption.findFirst.mockResolvedValue({ id: 'adopt-1' });
      await expect(service.adopt('org-1', 'user-1', 'duty-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('materialises turns ahead, so the duty shows a name on the calendar', async () => {
      prisma.dutyAdoption.findFirst.mockResolvedValueOnce(null);
      prisma.dutyAdoption.findFirst.mockResolvedValue({
        id: 'adopt-1',
        userId: 'user-1',
        releasedAt: null,
        duty: TUESDAY_DUTY,
      });

      const result = await service.adopt('org-1', 'user-1', 'duty-1');
      // Weekly over a 120-day horizon.
      expect(result.claimed).toBeGreaterThan(15);
    });

    it('hands back only the turns still ahead', async () => {
      prisma.dutyAdoption.findFirst.mockResolvedValue({ id: 'adopt-1', userId: 'user-1' });
      await service.releaseAdoption('org-1', 'user-1', 'adopt-1');

      // Turns already done are facts about the past, and the hours stay banked.
      expect(prisma.dutyClaim.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occursAt: { gt: expect.any(Date) },
            status: { in: ['CLAIMED', 'CONFIRMED'] },
          }),
        }),
      );
    });

    it("will not let somebody hand back another member's arrangement", async () => {
      prisma.dutyAdoption.findFirst.mockResolvedValue({ id: 'adopt-1', userId: 'someone-else' });
      await expect(
        service.releaseAdoption('org-1', 'user-1', 'adopt-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('marking a turn done', () => {
    const claim = {
      id: 'claim-1',
      userId: 'user-1',
      status: 'CONFIRMED',
      duty: TUESDAY_DUTY,
    };

    it("credits the duty's estimate when nobody says otherwise", async () => {
      prisma.dutyClaim.findFirst.mockResolvedValue(claim);
      await service.complete('org-1', 'user-1', 'claim-1', {});

      expect(prisma.dutyClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ minutes: 30, minutesEdited: false }),
        }),
      );
    });

    it('records a correction as a correction', async () => {
      prisma.dutyClaim.findFirst.mockResolvedValue(claim);
      await service.complete('org-1', 'user-1', 'claim-1', {
        minutes: 90,
        note: 'Bin store was locked.',
      });

      expect(prisma.dutyClaim.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            minutes: 90,
            minutesEdited: true,
            minutesNote: 'Bin store was locked.',
          }),
        }),
      );
    });

    it('will not bank a turn waiting on an organiser', async () => {
      prisma.dutyClaim.findFirst.mockResolvedValue({ ...claim, status: 'CLAIMED' });
      await expect(
        service.complete('org-1', 'user-1', 'claim-1', {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("will not let somebody bank another member's turn", async () => {
      prisma.dutyClaim.findFirst.mockResolvedValue({ ...claim, userId: 'someone-else' });
      await expect(
        service.complete('org-1', 'user-1', 'claim-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('retiring a duty', () => {
    it('deletes one nobody has ever served', async () => {
      prisma.dutyClaim.count.mockResolvedValue(0);
      await service.removeDuty('org-1', 'duty-1');
      expect(prisma.duty.delete).toHaveBeenCalled();
    });

    it('keeps one that carries somebody\'s hours', async () => {
      // Deleting cascades to the claims, which is the record members are
      // measured against. Tidying up must not erase it.
      prisma.dutyClaim.count.mockResolvedValue(4);
      await service.removeDuty('org-1', 'duty-1');
      expect(prisma.duty.delete).not.toHaveBeenCalled();
      expect(prisma.duty.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
    });
  });

  describe('the open list', () => {
    it('reports how many are still needed on each turn', async () => {
      prisma.duty.findMany.mockResolvedValue([{ ...TUESDAY_DUTY, capacity: 2 }]);
      prisma.dutyClaim.findMany.mockResolvedValue([
        {
          id: 'c1',
          dutyId: 'duty-1',
          userId: 'user-9',
          status: 'CONFIRMED',
          occursAt: new Date('2026-09-08T12:00:00.000Z'),
          user: { id: 'user-9', name: 'Maya', avatarUrl: null },
        },
      ]);

      const { occurrences } = await service.openings('org-1', {
        from: '2026-09-08',
        to: '2026-09-08',
      });

      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].remaining).toBe(1);
      expect(occurrences[0].claims[0].name).toBe('Maya');
    });
  });
});
