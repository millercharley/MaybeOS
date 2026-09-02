import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';
import { StorageService } from '../../storage/storage.service';

/**
 * A room's cap on how long a booking may run (SPC-09).
 *
 * Enforced on the server as well as in the duration chips. The chips are what
 * a member sees; a request that never went through them is the one this
 * exists to stop, and "the UI won't let you" has never been a control.
 */
describe('SpaceService — maximum booking length', () => {
  let service: SpaceService;
  let prisma: any;

  const room = (maxBookingMinutes: number | null) => ({
    id: 'room-1',
    orgId: 'org-1',
    isActive: true,
    requiresApproval: false,
    chargeForBooking: false,
    hourlyRate: null,
    alwaysAvailable: true,
    availabilityRules: [],
    maxBookingMinutes,
    org: { timezone: 'America/New_York' },
  });

  const booking = (hours: number) => ({
    title: 'Rehearsal',
    startTime: '2026-09-10T14:00:00.000Z',
    endTime: new Date(Date.UTC(2026, 8, 10, 14 + hours)).toISOString(),
  });

  beforeEach(async () => {
    prisma = {
      room: { findFirst: jest.fn() },
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'booking-1', status: 'APPROVED' }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendBookingEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => undefined } },
        { provide: EventsService, useValue: {} },
        { provide: ConnectService, useValue: {} },
        {
          provide: CalendarService,
          useValue: {
            syncBooking: jest.fn().mockResolvedValue({ synced: false }),
            busyConflictForRoom: jest.fn().mockResolvedValue({ busy: false }),
          },
        },
        {
          provide: StorageService,
          useValue: { signedAttachmentUrls: jest.fn().mockResolvedValue(new Map()) },
        },
      ],
    }).compile();

    service = moduleRef.get(SpaceService);
  });

  it('refuses a booking longer than the room allows', async () => {
    prisma.room.findFirst.mockResolvedValue(room(120));

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', booking(3) as never),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('says what the limit actually is', async () => {
    prisma.room.findFirst.mockResolvedValue(room(120));

    // "Invalid duration" leaves a member guessing at what would work.
    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', booking(3) as never),
    ).rejects.toThrow('up to 2 hours at a time');
  });

  it('accepts a booking exactly at the cap', async () => {
    prisma.room.findFirst.mockResolvedValue(room(120));

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', booking(2) as never),
    ).resolves.toBeDefined();
  });

  it('leaves a room with no cap alone', async () => {
    // Null means no limit, which is what every room built before SPC-09 has.
    prisma.room.findFirst.mockResolvedValue(room(null));

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', booking(6) as never),
    ).resolves.toBeDefined();
  });

  it('reads a cap that is not a whole number of hours in minutes', async () => {
    prisma.room.findFirst.mockResolvedValue(room(90));

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', booking(2) as never),
    ).rejects.toThrow('up to 90 minutes at a time');
  });
});
