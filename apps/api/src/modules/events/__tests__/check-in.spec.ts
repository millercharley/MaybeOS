import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';

/**
 * Attendance can be recorded (IMP-10).
 *
 * The check-in path has existed since EventOS was built and no screen ever
 * called it, so the `attendance` table held 0 rows against 13 RSVPs and every
 * reach figure in the impact dashboard was structurally zero — not wrong, but
 * incapable of ever being anything else.
 *
 * Three things had to change before a door list could use it: it was keyed on
 * a user id, so guest RSVPs could never be checked in; a second call answered
 * 400, so a double tap looked like a fault; and nothing could undo a
 * check-in, so one mis-tap permanently overstated a number that ends up in a
 * report.
 */
describe('EventsService — check-in', () => {
  let service: EventsService;
  let prisma: {
    event: { findFirst: jest.Mock };
    rsvp: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    attendance: { create: jest.Mock; deleteMany: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const EVENT = 'event-1';

  beforeEach(async () => {
    prisma = {
      event: { findFirst: jest.fn().mockResolvedValue({ id: EVENT, orgId: 'org-1' }) },
      rsvp: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      attendance: { create: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
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

  describe('checking someone in', () => {
    it('writes both the RSVP flag and an attendance row', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-1',
        userId: 'user-1',
        status: 'CONFIRMED',
        checkedIn: false,
      });
      prisma.rsvp.update.mockResolvedValue({ id: 'rsvp-1', checkedIn: true });

      await service.checkIn('org-1', EVENT, 'rsvp-1');

      expect(prisma.rsvp.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ checkedIn: true }) }),
      );
      // The dashboard counts the attendance table, not the flag; a check-in
      // that updated only one of the two would not reach any report.
      expect(prisma.attendance.create).toHaveBeenCalledWith({
        data: { eventId: EVENT, userId: 'user-1', guestEmail: null, method: 'manual' },
      });
    });

    it('works for a guest RSVP, which the old signature could not reach', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-2',
        userId: null,
        guestEmail: 'visitor@example.com',
        status: 'CONFIRMED',
        checkedIn: false,
      });
      prisma.rsvp.update.mockResolvedValue({ id: 'rsvp-2', checkedIn: true });

      await service.checkIn('org-1', EVENT, 'rsvp-2');

      expect(prisma.attendance.create).toHaveBeenCalledWith({
        data: {
          eventId: EVENT,
          userId: null,
          guestEmail: 'visitor@example.com',
          method: 'manual',
        },
      });
    });

    it('is idempotent — a double tap is a slip, not an error', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-1',
        userId: 'user-1',
        status: 'CONFIRMED',
        checkedIn: true,
      });

      const result = await service.checkIn('org-1', EVENT, 'rsvp-1');

      expect(result.alreadyCheckedIn).toBe(true);
      // Crucially it does not write a second attendance row, which would
      // inflate the count for the same person.
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('refuses a cancelled RSVP', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-3',
        userId: 'user-3',
        status: 'CANCELED',
        checkedIn: false,
      });

      await expect(service.checkIn('org-1', EVENT, 'rsvp-3')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('will not check in an RSVP belonging to another event', async () => {
      prisma.rsvp.findFirst.mockResolvedValue(null);

      await expect(service.checkIn('org-1', EVENT, 'rsvp-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // Scoped by eventId as well as id, so a UUID from another event misses.
      expect(prisma.rsvp.findFirst).toHaveBeenCalledWith({
        where: { id: 'rsvp-x', eventId: EVENT },
      });
    });
  });

  describe('undoing a check-in', () => {
    it('clears the flag and removes the attendance it created', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-1',
        userId: 'user-1',
        checkedIn: true,
      });
      prisma.rsvp.update.mockResolvedValue({ id: 'rsvp-1', checkedIn: false });

      await service.undoCheckIn('org-1', EVENT, 'rsvp-1');

      expect(prisma.rsvp.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { checkedIn: false, checkedInAt: null },
        }),
      );
      expect(prisma.attendance.deleteMany).toHaveBeenCalledWith({
        where: { eventId: EVENT, userId: 'user-1' },
      });
    });

    it('removes a guest\'s attendance by their email, not every guest row', async () => {
      prisma.rsvp.findFirst.mockResolvedValue({
        id: 'rsvp-2',
        userId: null,
        guestEmail: 'visitor@example.com',
        checkedIn: true,
      });
      prisma.rsvp.update.mockResolvedValue({ id: 'rsvp-2' });

      await service.undoCheckIn('org-1', EVENT, 'rsvp-2');

      expect(prisma.attendance.deleteMany).toHaveBeenCalledWith({
        where: { eventId: EVENT, userId: null, guestEmail: 'visitor@example.com' },
      });
    });
  });

  describe('walk-ins', () => {
    it('records someone with no RSVP', async () => {
      await service.recordWalkIn('org-1', EVENT, 'Sam from the allotment');

      expect(prisma.attendance.create).toHaveBeenCalledWith({
        data: {
          eventId: EVENT,
          userId: null,
          guestName: 'Sam from the allotment',
          method: 'self',
        },
      });
    });

    it('accepts no name at all — the count is the point', async () => {
      await service.recordWalkIn('org-1', EVENT, '   ');

      expect(prisma.attendance.create).toHaveBeenCalledWith({
        data: { eventId: EVENT, userId: null, guestName: null, method: 'self' },
      });
    });
  });

  describe('the door list', () => {
    beforeEach(() => {
      prisma.rsvp.findMany.mockResolvedValue([
        { id: 'r1', userId: 'u1', user: { id: 'u1', name: 'Zoe', avatarUrl: null }, status: 'CONFIRMED', plusOnes: 0, checkedIn: true, checkedInAt: new Date() },
        { id: 'r2', userId: null, guestName: 'Alex', user: null, status: 'CONFIRMED', plusOnes: 1, checkedIn: false, checkedInAt: null },
        { id: 'r3', userId: 'u3', user: { id: 'u3', name: 'Mo', avatarUrl: null }, status: 'WAITLISTED', plusOnes: 0, checkedIn: false, checkedInAt: null },
      ]);
      prisma.attendance.findMany.mockResolvedValue([
        // The checked-in RSVP above wrote this one.
        { id: 'a0', userId: 'u1', guestName: null, method: 'manual', createdAt: new Date() },
        { id: 'a1', userId: null, guestName: 'Passer-by', method: 'self', createdAt: new Date() },
      ]);
    });

    it('excludes cancelled RSVPs from the query, so nobody is checked in by mistake', async () => {
      await service.listAttendees('org-1', EVENT);

      expect(prisma.rsvp.findMany.mock.calls[0][0].where.status).toEqual({
        in: ['CONFIRMED', 'WAITLISTED'],
      });
    });

    it('sorts by name, the way somebody at a door scans a list', async () => {
      const list = await service.listAttendees('org-1', EVENT);

      expect(list.expected.map((a) => a.name)).toEqual(['Alex', 'Mo', 'Zoe']);
    });

    it('counts the attendance rows themselves, so the door and the report agree', async () => {
      const list = await service.listAttendees('org-1', EVENT);

      // The dashboard counts this table; summing RSVP flags and walk-ins
      // separately is what let a guest be counted twice.
      expect(list.attendanceCount).toBe(2);
      // Expected is confirmed RSVPs only — a waitlisted person is not expected.
      expect(list.expectedCount).toBe(2);
    });

    it('does not mistake a checked-in guest for a walk-in', async () => {
      // A guest RSVP has no user, so selecting walk-ins on `userId: null`
      // listed them twice and inflated the count.
      prisma.attendance.findMany.mockResolvedValue([
        { id: 'a2', userId: null, guestEmail: 'visitor@example.com', method: 'manual', createdAt: new Date() },
        { id: 'a1', userId: null, guestName: 'Passer-by', method: 'self', createdAt: new Date() },
      ]);

      const list = await service.listAttendees('org-1', EVENT);

      expect(list.walkIns).toHaveLength(1);
      expect(list.walkIns[0].name).toBe('Passer-by');
      expect(list.attendanceCount).toBe(2);
    });
  });
});
