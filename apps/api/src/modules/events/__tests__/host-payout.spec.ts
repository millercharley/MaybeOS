import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HostPayoutService, shareOf } from '../host-payout.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Paying a member who hosted an event (EVT-15).
 *
 * This is somebody's money, so the tests are about the arithmetic being right
 * and about what it refuses to do rather than about the happy path.
 */
describe('HostPayoutService', () => {
  let service: HostPayoutService;
  let prisma: any;

  const past = new Date('2026-01-01');
  const future = new Date('2099-01-01');

  /** A $10 ticket on the FREE plan: buyer paid $11.00, host's price was $10. */
  const ticket = (over: Record<string, unknown> = {}) => ({
    amountCents: 1100,
    platformFeeCents: 100,
    orgFeeCents: 0,
    refundedAt: null,
    ...over,
  });

  const event = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    title: 'Repair café',
    endTime: past,
    hostId: 'u1',
    hostRevenueShareBps: null,
    host: { id: 'u1', name: 'Maya' },
    org: { hostRevenueShareBps: 10000 },
    payout: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      event: { findFirst: jest.fn().mockResolvedValue(event()), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      ticket: { findMany: jest.fn().mockResolvedValue([ticket(), ticket()]) },
      hostPayout: { upsert: jest.fn().mockImplementation(({ create }: any) => create), findFirst: jest.fn(), update: jest.fn() },
      organization: { update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [HostPayoutService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<HostPayoutService>(HostPayoutService);
  });

  describe('what "the ticket money" means', () => {
    it('pays face value, not what the buyer was charged', async () => {
      // Two $10 tickets: the buyer paid $22.00 all in, $2.00 of which was
      // MaybeOS's. Paying out of the buyer's total would hand the host
      // MaybeOS's cut.
      const preview = await service.previewForEvent('org-1', 'e1');

      expect(preview.grossCents).toBe(2000);
      expect(preview.amountCents).toBe(2000);
    });

    it('leaves the co-op its own fee', async () => {
      // A co-op charging $2 a ticket for the room keeps it; the host's price
      // was still $10.
      prisma.ticket.findMany.mockResolvedValue([ticket({ amountCents: 1300, orgFeeCents: 200 })]);

      expect((await service.previewForEvent('org-1', 'e1')).grossCents).toBe(1000);
    });

    it('excludes refunded tickets, and counts them', async () => {
      prisma.ticket.findMany.mockResolvedValue([ticket(), ticket({ refundedAt: new Date() })]);

      const preview = await service.previewForEvent('org-1', 'e1');

      expect(preview.grossCents).toBe(1000);
      expect(preview.ticketCount).toBe(1);
      expect(preview.refundedCount).toBe(1);
    });
  });

  describe('the share', () => {
    it('defaults to all of it', async () => {
      expect((await service.previewForEvent('org-1', 'e1')).shareBps).toBe(10000);
    });

    it('uses the co-op’s default', async () => {
      prisma.event.findFirst.mockResolvedValue(event({ org: { hostRevenueShareBps: 8000 } }));

      const preview = await service.previewForEvent('org-1', 'e1');

      expect(preview.amountCents).toBe(1600); // 80% of $20
    });

    it('lets one event override the default', async () => {
      // "We take 20% for the room, except for the fundraiser."
      prisma.event.findFirst.mockResolvedValue(
        event({ hostRevenueShareBps: 10000, org: { hostRevenueShareBps: 8000 } }),
      );

      expect((await service.previewForEvent('org-1', 'e1')).amountCents).toBe(2000);
    });

    it('rounds down, so the co-op is never short', () => {
      // A cent rounded the other way on every event is a co-op that slowly
      // pays out more than it took.
      expect(shareOf(1001, 3333)).toBe(333);
      expect(shareOf(999, 10000)).toBe(999);
      expect(shareOf(0, 10000)).toBe(0);
    });

    it('refuses a share outside 0–100%', async () => {
      await expect(service.setOrgShare('org-1', 10001)).rejects.toThrow(BadRequestException);
      await expect(service.setOrgShare('org-1', -1)).rejects.toThrow(BadRequestException);
      await expect(service.setOrgShare('org-1', 5000)).resolves.toEqual({ hostRevenueShareBps: 5000 });
    });
  });

  describe('what marking paid refuses', () => {
    it('will not pay out before the event has happened', async () => {
      // Tickets can still be sold and refunded right up to the door, so what
      // is owed is not final yet.
      prisma.event.findFirst.mockResolvedValue(event({ endTime: future }));

      await expect(service.markPaid('org-1', 'e1', 'admin-1')).rejects.toThrow(/not finished/i);
    });

    it('will not pay the same host twice', async () => {
      prisma.event.findFirst.mockResolvedValue(event({ payout: { status: 'PAID' } }));

      await expect(service.markPaid('org-1', 'e1', 'admin-1')).rejects.toThrow(/already been paid/i);
    });

    it('will not pay an event with no host', async () => {
      prisma.event.findFirst.mockResolvedValue(event({ host: null, hostId: null }));

      await expect(service.markPaid('org-1', 'e1', 'admin-1')).rejects.toThrow(/no host/i);
    });

    it('will not pay nothing', async () => {
      prisma.ticket.findMany.mockResolvedValue([ticket({ refundedAt: new Date() })]);

      await expect(service.markPaid('org-1', 'e1', 'admin-1')).rejects.toThrow(/nothing to pay/i);
    });
  });

  describe('the record it writes', () => {
    it('freezes the figures and who marked it', async () => {
      const payout = await service.markPaid('org-1', 'e1', 'admin-1', ' bank transfer ');

      // Frozen: a refund next week changes what the co-op holds, not what was
      // handed over on the day.
      expect(payout).toMatchObject({
        grossCents: 2000,
        amountCents: 2000,
        shareBps: 10000,
        ticketCount: 2,
        status: 'PAID',
        paidById: 'admin-1',
        note: 'bank transfer',
      });
    });

    it('cancels rather than deletes', async () => {
      prisma.hostPayout.findFirst.mockResolvedValue({ id: 'p1' });

      await service.cancel('org-1', 'e1');

      // "We said we paid this and we had not" is a thing that happened, and
      // this row is the only place it is written down.
      expect(prisma.hostPayout.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { status: 'CANCELLED', paidAt: null },
      });
    });
  });
});
