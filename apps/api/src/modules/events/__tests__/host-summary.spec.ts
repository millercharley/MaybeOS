import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../config/prisma.service';
import { EventsService } from '../events.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';
import { CalendarService } from '../../calendar/calendar.service';
import { ConnectService } from '../../stripe/connect.service';
import { StorageService } from '../../storage/storage.service';

/**
 * How it went, for the person who hosted it (delight #5).
 *
 * The judgements worth pinning are about what a host is told, not about the
 * arithmetic: that a summary of something that has not happened is not
 * offered, that attendance says which number it is, and that the money is
 * broken out rather than left as one figure to interpret.
 */
describe('EventsService.hostSummary', () => {
  let prisma: any;
  let service: EventsService;

  const PAST = new Date('2026-08-01T20:00:00Z');
  const FUTURE = new Date('2099-01-01T20:00:00Z');

  const event = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    title: 'Monthly supper',
    slug: 'monthly-supper',
    startTime: PAST,
    endTime: PAST,
    hostId: 'host1',
    rsvps: [],
    payout: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = { event: { findFirst: jest.fn().mockResolvedValue(event()) } };
    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: CalendarService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(EventsService);
  });

  it('offers nothing for an event that has not happened', async () => {
    // A "summary" of a future event is a forecast, and hosts read the two
    // very differently.
    prisma.event.findFirst.mockResolvedValue(event({ endTime: FUTURE }));
    await expect(service.hostSummary('org1', 'e1', 'host1', false)).resolves.toMatchObject({
      ended: false,
    });
  });

  it('hides somebody else’s event rather than forbidding it', async () => {
    // Whether another member's event exists is not this member's business
    // either, so 404 rather than 403.
    await expect(service.hostSummary('org1', 'e1', 'someone-else', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('lets an organiser see it', async () => {
    await expect(service.hostSummary('org1', 'e1', 'staff', true)).resolves.toMatchObject({
      ended: true,
    });
  });

  describe('attendance says which number it is', () => {
    it('counts check-ins when the door was scanned', async () => {
      prisma.event.findFirst.mockResolvedValue(
        event({
          rsvps: [
            { status: 'CONFIRMED', checkedIn: true, plusOnes: 0 },
            { status: 'CONFIRMED', checkedIn: true, plusOnes: 0 },
            { status: 'CONFIRMED', checkedIn: false, plusOnes: 1 },
          ],
        }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.attendance).toMatchObject({ basis: 'check-ins', counted: 2, expected: 4 });
    });

    it('falls back to RSVPs when nobody scanned, and says so', async () => {
      // A door nobody scanned is not an event nobody came to.
      prisma.event.findFirst.mockResolvedValue(
        event({ rsvps: [{ status: 'CONFIRMED', checkedIn: false, plusOnes: 1 }] }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.attendance).toMatchObject({ basis: 'rsvps', counted: 2 });
    });

    it('counts plus-ones as people, because they ate', async () => {
      prisma.event.findFirst.mockResolvedValue(
        event({ rsvps: [{ status: 'CONFIRMED', checkedIn: false, plusOnes: 3 }] }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.attendance.expected).toBe(4);
    });

    it('ignores cancelled RSVPs', async () => {
      prisma.event.findFirst.mockResolvedValue(
        event({
          rsvps: [
            { status: 'CANCELED', checkedIn: false, plusOnes: 0 },
            { status: 'CONFIRMED', checkedIn: false, plusOnes: 0 },
          ],
        }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.attendance.expected).toBe(1);
    });
  });

  describe('the money is broken out, not left to interpret', () => {
    it('shows gross, the co-op’s share, and what is left', async () => {
      // A host who sees only what they are owed cannot tell whether a low
      // number means few tickets or a large share to the co-op.
      prisma.event.findFirst.mockResolvedValue(
        event({
          payout: {
            ticketCount: 20,
            refundedCount: 1,
            grossCents: 20000,
            amountCents: 18000,
            status: 'PENDING',
            paidAt: null,
          },
        }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.money).toMatchObject({
        grossCents: 20000,
        coopShareCents: 2000,
        netCents: 18000,
        ticketCount: 20,
        refundedCount: 1,
      });
    });

    it('reads the payout rather than recomputing it', async () => {
      // What a host is shown has to be what the co-op will actually pay
      // (EVT-15), not a second calculation that can disagree with it.
      prisma.event.findFirst.mockResolvedValue(
        event({
          payout: { ticketCount: 5, refundedCount: 0, grossCents: 5000, amountCents: 4321, status: 'PAID', paidAt: PAST },
        }),
      );
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.money.netCents).toBe(4321);
      expect(s.money.status).toBe('PAID');
    });

    it('says nothing about money for a free event', async () => {
      const s: any = await service.hostSummary('org1', 'e1', 'host1', false);
      expect(s.money).toBeNull();
    });
  });
});
