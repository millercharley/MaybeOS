import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';

/**
 * An event records who runs it (EVT-04).
 *
 * `create` took the creator's user id and dropped it, because `Event` had no
 * column to put it in — so MaybeOS did not know who made any event. eslint's
 * first run found it as an unused parameter, which is the only reason anybody
 * noticed: nothing failed, the information was simply never kept.
 *
 * The PRD needs it. §6.2 sends a post-event follow-up "to the host" 72 hours
 * after an event ends, and Sam the event host is one of its four named users.
 * A follow-up with nobody to send it to is not a feature that degrades — it
 * is one that cannot exist.
 */
describe('EventsService — event host', () => {
  let service: EventsService;
  let prisma: {
    event: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };

  const ORG = 'org-1';
  const CREATOR = 'user-creator';
  // Reassigning a host is an organiser act (EVT-05); a member may edit the
  // event they host but not hand it to somebody else.
  const ORGANISER = { userId: 'user-admin', isStaff: true };

  const dto = {
    title: 'Repair Café',
    startTime: '2027-04-05T14:00:00.000Z',
    endTime: '2027-04-05T16:00:00.000Z',
  } as never;

  beforeEach(async () => {
    prisma = {
      event: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue({ id: 'event-1', orgId: ORG, title: 'Repair Café', startTime: new Date() }),
        update: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        // Cancelling an event refunds its tickets; these suites do not sell any.
        {
          provide: ConnectService,
          useValue: {
            refundEventTickets: jest
              .fn()
              .mockResolvedValue({ attempted: 0, refunded: 0, failed: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('creating', () => {
    it('records the creator as the host', async () => {
      await service.create(ORG, dto, CREATOR);

      expect(prisma.event.create.mock.calls[0][0].data.hostId).toBe(CREATOR);
    });

    it('lets an organiser name somebody else', async () => {
      // Making an event on a member's behalf is the normal case for a co-op
      // with one part-time admin, which is the PRD's primary user.
      await service.create(ORG, { ...(dto as object), hostId: 'user-sam' } as never, CREATOR);

      expect(prisma.event.create.mock.calls[0][0].data.hostId).toBe('user-sam');
    });
  });

  describe('updating', () => {
    it('reassigns the host', async () => {
      await service.update(ORG, 'event-1', { hostId: 'user-sam' } as never, ORGANISER);

      expect(prisma.event.update.mock.calls[0][0].data.hostId).toBe('user-sam');
    });

    it('clears the host when explicitly set to null', async () => {
      // An event can legitimately have nobody running it. A truthiness check
      // would silently ignore this and leave the previous host attached to an
      // event they have handed over.
      await service.update(ORG, 'event-1', { hostId: null } as never, ORGANISER);

      expect(prisma.event.update.mock.calls[0][0].data).toHaveProperty('hostId', null);
    });

    it('leaves the host alone when the field is absent', async () => {
      await service.update(ORG, 'event-1', { title: 'Renamed' } as never, ORGANISER);

      expect(prisma.event.update.mock.calls[0][0].data).not.toHaveProperty('hostId');
    });
  });

  describe('who can see the host', () => {
    it('includes the host on the org-scoped list', async () => {
      const listPrisma = prisma as unknown as { event: Record<string, jest.Mock> };
      listPrisma.event.findMany = jest.fn().mockResolvedValue([]);
      listPrisma.event.count = jest.fn().mockResolvedValue(0);
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((ops: unknown[]) =>
        Promise.all(ops),
      );

      await service.listByOrg(ORG, {});

      const include = listPrisma.event.findMany.mock.calls[0][0].include;
      expect(include.host.select).toEqual({ id: true, name: true, avatarUrl: true });
      // A name, a face and an id — never an email. Contact details follow
      // SEC-06, and nothing here is a route around it.
      expect(include.host.select).not.toHaveProperty('email');
    });

    it('does not include the host on the public list', async () => {
      const listPrisma = prisma as unknown as { event: Record<string, jest.Mock> };
      listPrisma.event.findMany = jest.fn().mockResolvedValue([]);
      listPrisma.event.count = jest.fn().mockResolvedValue(0);
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((ops: unknown[]) =>
        Promise.all(ops),
      );

      await service.listPublicEvents(ORG, {});

      // Publishing a member's name to anyone on the internet is the co-op's
      // decision, not something that should arrive with a schema change.
      expect(listPrisma.event.findMany.mock.calls[0][0].include).not.toHaveProperty('host');
    });
  });
});
