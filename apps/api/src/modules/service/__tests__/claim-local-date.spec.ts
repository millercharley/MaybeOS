import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceService } from '../service.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * A turn's day, said rather than inferred (SRV-08).
 *
 * `occursAt` is the instant a turn starts, so its UTC date is the co-op's
 * date only east of Greenwich. Every screen listing turns took the first ten
 * characters of the ISO string, which makes a 7pm turn in New York read as
 * tomorrow — the same cause as SPC-34 in room booking, found in the same
 * sweep.
 *
 * `DutyOccurrence` has carried `date` all along, which is why the rota read
 * correctly while the claim lists did not: the rota is built from
 * occurrences, and these are built from rows.
 *
 * Nothing on production currently falls on a different UTC date, so this was
 * latent rather than biting. Latent is the easier kind to fix and the harder
 * kind to notice.
 */
describe('ServiceService — the day a turn falls on', () => {
  let service: ServiceService;
  let prisma: any;

  /** 7pm in New York on 18 Feb is 00:00 UTC on the 19th. */
  const EVENING = new Date('2026-02-19T00:00:00.000Z');
  const LOCAL_DAY = '2026-02-18';

  const claim = (over: Record<string, unknown> = {}) => ({
    id: 'claim-1',
    dutyId: 'duty-1',
    userId: 'user-1',
    occursAt: EVENING,
    status: 'CONFIRMED',
    minutes: null,
    duty: { id: 'duty-1', title: 'Lock up', description: null, estimatedMinutes: 30 },
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }),
      },
      dutyClaim: { findMany: jest.fn().mockResolvedValue([claim()]) },
      dutyAdoption: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'adopt-1',
            dutyId: 'duty-1',
            userId: 'user-1',
            startedAt: EVENING,
            releasedAt: null,
            reviewedAt: null,
            duty: { id: 'duty-1', title: 'Lock up', recurrence: 'WEEKLY' },
            user: { id: 'user-1', name: 'Ada', avatarUrl: null },
          },
        ]),
      },
      userOrg: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ServiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendRaw: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = moduleRef.get(ServiceService);
    jest.useFakeTimers().setSystemTime(new Date('2026-02-18T12:00:00.000Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('is the co-op’s day, not the UTC day the instant lands on', async () => {
    const mine = await service.myService('org-1', 'user-1');

    expect(mine.upcoming[0].date).toBe(LOCAL_DAY);
    // The trap, stated: the instant really is the next day in UTC.
    expect(mine.upcoming[0].occursAt.toISOString().slice(0, 10)).toBe('2026-02-19');
  });

  it.each(['upcoming', 'needsLogging', 'past'] as const)(
    'carries the day on the %s list too',
    async (list) => {
      // Every list on the page shows a date, so every list has to carry one —
      // a page where two of three are right is harder to trust than one that
      // is wrong everywhere.
      const mine = await service.myService('org-1', 'user-1');
      const rows = mine[list] as Array<{ date?: string }>;

      for (const row of rows) expect(row.date).toBe(LOCAL_DAY);
    },
  );

  it('tells an organiser the same day it tells the member', async () => {
    prisma.dutyClaim.findMany.mockResolvedValue([
      { ...claim(), user: { id: 'user-1', name: 'Ada', avatarUrl: null } },
    ]);

    const pending = await service.pendingClaims('org-1');

    expect(pending[0].date).toBe(LOCAL_DAY);
  });

  it('dates a standing arrangement by the co-op’s day as well', async () => {
    const standing = await service.standingDuties('org-1');

    expect(standing[0].startedOn).toBe(LOCAL_DAY);
  });

  /**
   * East of Greenwich the instant and its UTC date agree, which is exactly
   * why this survived: every test and every glance at the data looked right.
   */
  it('is right in a zone where slicing the instant would also have worked', async () => {
    prisma.organization.findUnique.mockResolvedValue({ timezone: 'Europe/Berlin' });

    const mine = await service.myService('org-1', 'user-1');

    expect(mine.upcoming[0].date).toBe('2026-02-19');
  });
});
