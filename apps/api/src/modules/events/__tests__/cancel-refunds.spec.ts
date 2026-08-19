import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';

/**
 * Cancelling an event returns everyone's money — by every route.
 *
 * There are two ways an event gets cancelled and only one of them is obvious.
 * An organiser cancelling directly is the one people think about. The other is
 * a member cancelling the room booking their event was published from
 * (EVT-05): they are thinking about the room, not about the strangers who
 * bought tickets to what they booked it for. That path will be taken more
 * often and is the one worth a test.
 */
describe('EventsService — cancelling refunds tickets', () => {
  let service: EventsService;
  let prisma: { event: Record<string, jest.Mock> };
  let connect: { refundEventTickets: jest.Mock };

  const ORG = 'org-1';
  const ORGANISER = { userId: 'user-admin', isStaff: true };

  beforeEach(async () => {
    prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue({ id: 'event-1', orgId: ORG, hostId: 'user-1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'event-1', canceledAt: new Date() }),
      },
    };
    connect = {
      refundEventTickets: jest
        .fn()
        .mockResolvedValue({ attempted: 3, refunded: 3, failed: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConnectService, useValue: connect },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('an organiser cancelling directly', () => {
    it('refunds the tickets', async () => {
      await service.cancel(ORG, 'event-1', ORGANISER);

      expect(connect.refundEventTickets).toHaveBeenCalledWith(ORG, 'event-1');
    });

    it('reports what happened rather than implying everyone was repaid', async () => {
      const result = await service.cancel(ORG, 'event-1', ORGANISER);

      expect(result.refunds).toEqual({ attempted: 3, refunded: 3, failed: [] });
    });

    it('still cancels when the refunds fail outright', async () => {
      // People need to be told the event is off even if Stripe is down. An
      // event left live because a refund failed is the worse outcome: money
      // can be returned on a retry, a wasted journey cannot.
      connect.refundEventTickets.mockRejectedValue(new Error('stripe unreachable'));

      const result = await service.cancel(ORG, 'event-1', ORGANISER);

      expect(prisma.event.update.mock.calls[0][0].data.canceledAt).toBeInstanceOf(Date);
      expect(result.refunds).toMatchObject({ error: 'stripe unreachable' });
    });
  });

  describe('a member cancelling the room booking underneath it', () => {
    it('refunds the tickets too', async () => {
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        canceledAt: null,
        orgId: ORG,
      });

      await service.syncWithBooking('booking-1', { canceled: true });

      // Scoped, not just triggered: refunds move a co-op's money, so the co-op
      // has to be named rather than inferred from the ticket id (SEC-04).
      expect(connect.refundEventTickets).toHaveBeenCalledWith(ORG, 'event-1');
    });

    it('does not refund again for an event already cancelled', async () => {
      // Otherwise a second booking webhook re-runs refunds on tickets that
      // were already returned — harmless per ticket, but it would report a
      // fresh round of refunds that did not happen.
      prisma.event.findUnique.mockResolvedValue({
        id: 'event-1',
        canceledAt: new Date('2026-01-01'),
      });

      await service.syncWithBooking('booking-1', { canceled: true });

      expect(connect.refundEventTickets).not.toHaveBeenCalled();
    });

    it('does not refund when the booking merely moved', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'event-1', canceledAt: null });

      await service.syncWithBooking('booking-1', {
        startTime: new Date('2027-05-01T10:00:00Z'),
        endTime: new Date('2027-05-01T12:00:00Z'),
      });

      expect(connect.refundEventTickets).not.toHaveBeenCalled();
    });
  });
});
