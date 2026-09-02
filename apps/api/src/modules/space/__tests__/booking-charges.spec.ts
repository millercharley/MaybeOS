import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SpaceService } from '../space.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { EventsService } from '../../events/events.service';
import { ConnectService } from '../../stripe/connect.service';
import { CalendarService } from '../../calendar/calendar.service';

/**
 * Charging for room hire (SPC-06).
 *
 * `Room.hourlyRate` sat in the schema since SpaceOS was built and nothing read
 * it — a room set to $45/hour returned an APPROVED booking with no cost
 * anywhere. These cover the rules that decide whether money is involved at
 * all, and what a booking is worth before it has been paid for.
 */
describe('SpaceService — charging for hire', () => {
  let service: SpaceService;
  let prisma: any;
  let connect: { createBookingCheckout: jest.Mock; refundBooking: jest.Mock };

  const freeRoom = {
    id: 'room-1',
    orgId: 'org-1',
    isActive: true,
    requiresApproval: false,
    chargeForBooking: false,
    hourlyRate: null,
    availabilityRules: [],
  };

  const dto = {
    title: 'Rehearsal',
    startTime: '2026-09-01T09:00:00.000Z',
    endTime: '2026-09-01T12:00:00.000Z',
  };

  const createdWith = () => prisma.booking.create.mock.calls[0][0].data;

  beforeEach(async () => {
    prisma = {
      room: { findFirst: jest.fn().mockResolvedValue(freeRoom) },
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'booking-1', ...data })),
        update: jest.fn().mockResolvedValue({ id: 'booking-1' }),
      },
    };
    connect = {
      createBookingCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe/x' }),
      refundBooking: jest.fn().mockResolvedValue({ refunded: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SpaceService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendBookingReceived: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: EventsService, useValue: { syncWithBooking: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConnectService, useValue: connect },
        {
          provide: CalendarService,
          useValue: {
            syncBooking: jest.fn().mockResolvedValue({ synced: false }),
            busyConflictForRoom: jest.fn().mockResolvedValue({ busy: false }),
          },
        },
      ],
    }).compile();

    service = module.get<SpaceService>(SpaceService);
    jest.spyOn(service as any, 'notifyBooking').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'validateAvailability').mockReturnValue(undefined);
  });

  it('does not charge for a room by default', async () => {
    // Charley, 2026-08-13: rooms have no booking fee unless one is activated.
    const booking = await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect(connect.createBookingCheckout).not.toHaveBeenCalled();
    expect(createdWith().status).toBe('APPROVED');
    expect(createdWith().holdExpiresAt).toBeUndefined();
    expect((booking as any).checkoutUrl).toBeUndefined();
  });

  it('does not charge when a rate is set but charging was never switched on', async () => {
    // A rate on its own records what a room is worth. Treating that as consent
    // to bill people would turn a note into a charge.
    prisma.room.findFirst.mockResolvedValue({
      ...freeRoom,
      chargeForBooking: false,
      hourlyRate: 4500,
    });

    await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect(connect.createBookingCheckout).not.toHaveBeenCalled();
    expect(createdWith().status).toBe('APPROVED');
  });

  it('does not charge when charging is on but no rate was ever set', async () => {
    // Otherwise a half-filled form sends a member to a checkout for nothing.
    prisma.room.findFirst.mockResolvedValue({
      ...freeRoom,
      chargeForBooking: true,
      hourlyRate: null,
    });

    await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect(connect.createBookingCheckout).not.toHaveBeenCalled();
    expect(createdWith().status).toBe('APPROVED');
  });

  it('holds the slot and returns a checkout when the room charges', async () => {
    prisma.room.findFirst.mockResolvedValue({
      ...freeRoom,
      chargeForBooking: true,
      hourlyRate: 4500,
    });

    const booking = await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect(createdWith().status).toBe('PENDING_PAYMENT');
    expect(createdWith().holdExpiresAt).toBeInstanceOf(Date);
    expect((booking as any).checkoutUrl).toBe('https://checkout.stripe/x');
  });

  it('leaves no hold behind when the checkout cannot even start', async () => {
    // Found by running it: a co-op that has not finished Stripe onboarding got
    // an honest 400 while the hold stayed, blocking that slot for half an hour.
    // Repeat that and a co-op fills its own calendar with holds for payments
    // that never began, and members are told the room is taken.
    prisma.room.findFirst.mockResolvedValue({
      ...freeRoom,
      chargeForBooking: true,
      hourlyRate: 4500,
    });
    prisma.booking.delete = jest.fn().mockResolvedValue({});
    connect.createBookingCheckout.mockRejectedValue(new Error('payments not set up'));

    await expect(
      service.createBooking('org-1', 'room-1', 'user-1', dto as any),
    ).rejects.toThrow('payments not set up');

    expect(prisma.booking.delete).toHaveBeenCalledWith({ where: { id: 'booking-1' } });
  });

  it('does not tell anyone the room is booked before it is paid for', async () => {
    // The confirmation email goes out from the webhook. "Your booking is
    // confirmed" for an unpaid hold is a lie the member turns up on.
    prisma.room.findFirst.mockResolvedValue({
      ...freeRoom,
      chargeForBooking: true,
      hourlyRate: 4500,
    });

    await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect((service as any).notifyBooking).not.toHaveBeenCalled();
  });

  it('still emails immediately for a free room', async () => {
    await service.createBooking('org-1', 'room-1', 'user-1', dto as any);

    expect((service as any).notifyBooking).toHaveBeenCalledWith('booking-1', 'confirmed');
  });

  it('counts a live payment hold as a conflict', async () => {
    // A room hour is exclusive: two members must not be able to pay for it.
    await service.checkConflicts('room-1', new Date(dto.startTime), new Date(dto.endTime));

    const where = prisma.booking.findFirst.mock.calls[0][0].where;
    const holdClause = where.OR.find((c: any) => c.status === 'PENDING_PAYMENT');

    expect(holdClause).toBeDefined();
    expect(holdClause.holdExpiresAt.gt).toBeInstanceOf(Date);
  });

  it('refunds through the org, never by bare booking id', async () => {
    // SEC-04's guard caught the first version of this fetching a booking by id
    // alone. A refund is a money movement; resolving its target without a
    // tenant is exactly the shape that guard exists to stop.
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      status: 'PENDING',
      room: { requiresApproval: true },
    });
    jest.spyOn(service as any, 'findBookingInOrg').mockResolvedValue({
      id: 'booking-1',
      status: 'PENDING',
    });

    await service.rejectBooking('org-1', 'booking-1', 'admin-1');

    expect(connect.refundBooking).toHaveBeenCalledWith('org-1', 'booking-1');
  });

  it('ignores an expired hold, so an abandoned checkout frees the room', async () => {
    // The slot must come back when the hold lapses, not when the sweep next
    // runs — otherwise a member is refused a free room for up to 15 minutes.
    await service.checkConflicts('room-1', new Date(dto.startTime), new Date(dto.endTime));

    const where = prisma.booking.findFirst.mock.calls[0][0].where;
    const holdClause = where.OR.find((c: any) => c.status === 'PENDING_PAYMENT');
    const cutoff = holdClause.holdExpiresAt.gt as Date;

    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
