import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * Members create events, and an event published from a booking stays in step
 * with it (EVT-05).
 *
 * Charley's goal: a member booking a room should be offered the chance to
 * publish it as an event, and a member should also be able to go straight to
 * the events system and share something. Both mean event creation stops being
 * an organiser-only act.
 *
 * Which raises the failure this feature can cause that nobody can undo: an
 * event advertised in a room the co-op no longer holds. People have already
 * read it. Everything below about booking state exists for that.
 */
describe('EventsService — member events', () => {
  let service: EventsService;
  let prisma: {
    event: Record<string, jest.Mock>;
    booking: Record<string, jest.Mock>;
  };

  const ORG = 'org-1';
  const MEMBER = 'user-member';

  const booking = (over: Record<string, unknown> = {}) => ({
    id: 'booking-1',
    userId: MEMBER,
    roomId: 'room-1',
    title: 'Repair Café',
    status: 'APPROVED',
    startTime: new Date('2027-04-05T14:00:00Z'),
    endTime: new Date('2027-04-05T16:00:00Z'),
    room: { id: 'room-1', capacity: 30 },
    event: null,
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      event: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      booking: { findFirst: jest.fn() },
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
        // Waitlist promotion emails (EVT-16); these suites send none.
        { provide: EmailService, useValue: { sendWaitlistPromoted: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  describe('publishing an event from a booking', () => {
    it('takes the time and room from the booking rather than asking again', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking());

      await service.createFromBooking(ORG, 'booking-1', MEMBER, false, {});

      const data = prisma.event.create.mock.calls[0][0].data;
      expect(data.startTime).toEqual(new Date('2027-04-05T14:00:00Z'));
      expect(data.endTime).toEqual(new Date('2027-04-05T16:00:00Z'));
      expect(data.roomId).toBe('room-1');
      expect(data.title).toBe('Repair Café');
      expect(data.bookingId).toBe('booking-1');
      expect(data.hostId).toBe(MEMBER);
    });

    it('defaults to members-only, not public', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking());

      await service.createFromBooking(ORG, 'booking-1', MEMBER, false, {});

      // Publishing to the open internet under the co-op's name should be a
      // choice somebody makes, not what happens when they accept the default.
      expect(prisma.event.create.mock.calls[0][0].data.visibility).toBe('MEMBERS_ONLY');
    });

    it('publishes it live, because a draft nobody can share is a dead end', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking());

      await service.createFromBooking(ORG, 'booking-1', MEMBER, false, {});

      expect(prisma.event.create.mock.calls[0][0].data.isPublished).toBe(true);
    });

    it.each([['PENDING'], ['REJECTED'], ['CANCELED']])(
      'refuses a %s booking',
      async (status) => {
        prisma.booking.findFirst.mockResolvedValue(booking({ status }));

        await expect(
          service.createFromBooking(ORG, 'booking-1', MEMBER, false, {}),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(prisma.event.create).not.toHaveBeenCalled();
      },
    );

    it('refuses somebody else\'s booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking({ userId: 'someone-else' }));

      await expect(
        service.createFromBooking(ORG, 'booking-1', MEMBER, false, {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an organiser publish on a member\'s behalf', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking({ userId: 'someone-else' }));

      await service.createFromBooking(ORG, 'booking-1', 'user-admin', true, {});

      expect(prisma.event.create).toHaveBeenCalled();
    });

    it('refuses a second event on the same booking', async () => {
      prisma.booking.findFirst.mockResolvedValue(booking({ event: { id: 'event-9' } }));

      await expect(
        service.createFromBooking(ORG, 'booking-1', MEMBER, false, {}),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a booking in another org', async () => {
      prisma.booking.findFirst.mockResolvedValue(null);

      await expect(
        service.createFromBooking(ORG, 'booking-1', MEMBER, false, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.booking.findFirst.mock.calls[0][0].where).toEqual({
        id: 'booking-1',
        room: { orgId: ORG },
      });
    });
  });

  describe('keeping the event in step with the booking', () => {
    it('cancels the event when the booking is cancelled', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'event-1', canceledAt: null });

      await service.syncWithBooking('booking-1', { canceled: true });

      expect(prisma.event.update.mock.calls[0][0].data.canceledAt).toBeInstanceOf(Date);
    });

    it('moves the event when the booking is rescheduled', async () => {
      prisma.event.findUnique.mockResolvedValue({ id: 'event-1', canceledAt: null });
      const startTime = new Date('2027-05-01T10:00:00Z');
      const endTime = new Date('2027-05-01T12:00:00Z');

      await service.syncWithBooking('booking-1', { startTime, endTime });

      expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({ startTime, endTime });
    });

    it('never un-cancels an event', async () => {
      // People were told it was off. The booking coming back does not unsay it.
      const alreadyCanceled = new Date('2027-01-01T00:00:00Z');
      prisma.event.findUnique.mockResolvedValue({ id: 'event-1', canceledAt: alreadyCanceled });

      await service.syncWithBooking('booking-1', { canceled: true });

      expect(prisma.event.update.mock.calls[0][0].data).not.toHaveProperty('canceledAt');
    });

    it('does nothing for a booking with no event', async () => {
      prisma.event.findUnique.mockResolvedValue(null);

      await expect(service.syncWithBooking('booking-1', { canceled: true })).resolves.toBeNull();
      expect(prisma.event.update).not.toHaveBeenCalled();
    });
  });

  describe('who may change an event', () => {
    const hosted = { id: 'event-1', orgId: ORG, hostId: MEMBER, title: 'x', startTime: new Date() };

    it('lets the host edit their own', async () => {
      prisma.event.findFirst.mockResolvedValue(hosted);

      await service.update(ORG, 'event-1', { title: 'Renamed' } as never, {
        userId: MEMBER,
        isStaff: false,
      });

      expect(prisma.event.update).toHaveBeenCalled();
    });

    it('refuses a member who does not host it', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...hosted, hostId: 'someone-else' });

      await expect(
        service.update(ORG, 'event-1', { title: 'Renamed' } as never, {
          userId: MEMBER,
          isStaff: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets an organiser edit any event in the org', async () => {
      prisma.event.findFirst.mockResolvedValue({ ...hosted, hostId: 'someone-else' });

      await service.update(ORG, 'event-1', { title: 'Renamed' } as never, {
        userId: 'user-admin',
        isStaff: true,
      });

      expect(prisma.event.update).toHaveBeenCalled();
    });

    it('will not let a host hand the event to somebody else', async () => {
      prisma.event.findFirst.mockResolvedValue(hosted);

      // Reassigning volunteers that person for the post-event follow-up.
      await expect(
        service.update(ORG, 'event-1', { hostId: 'user-other' } as never, {
          userId: MEMBER,
          isStaff: false,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the host cancel their own event', async () => {
      prisma.event.findFirst.mockResolvedValue(hosted);

      await service.cancel(ORG, 'event-1', { userId: MEMBER, isStaff: false });

      expect(prisma.event.update.mock.calls[0][0].data.canceledAt).toBeInstanceOf(Date);
    });
  });
});
