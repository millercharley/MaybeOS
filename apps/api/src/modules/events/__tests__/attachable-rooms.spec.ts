import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * Which reservations an event is offered (SPC-31).
 *
 * Charley, publishing an event: "I'm seeing events that have already ended in
 * September in the list." The window reaches a fortnight back so that "I
 * booked it last week" still works, and nothing said the booking had to be
 * one that has not happened yet — so a member choosing a room for a future
 * evening was offered four that were already over.
 */
describe('EventsService — reservations an event may claim', () => {
  let service: EventsService;
  let prisma: any;

  const ORG = 'org-1';
  const ME = { userId: 'u-me', isOrganiser: false };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ requireEventRoom: false }) },
      event: { findFirst: jest.fn().mockResolvedValue(null) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
        { provide: ConnectService, useValue: {} },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EventsService);
  });

  /** The query the picker's list actually comes from. */
  async function queried(options: { eventId?: string } = {}) {
    await service.attachableRooms(ORG, ME, options);
    return prisma.booking.findMany.mock.calls[0][0];
  }

  it('leaves out reservations that have already finished', async () => {
    const { where } = await queried();

    const free = where.OR.find((clause: any) => clause.eventId === null);
    expect(free.endTime.gte).toBeInstanceOf(Date);
    // Now, not the start of the window: the fortnight back is for finding a
    // booking made last week, not for offering an evening that is over.
    expect(free.endTime.gte.getTime()).toBeCloseTo(Date.now(), -4);
  });

  it('keeps a reservation already attached to this event, whatever its date', async () => {
    /*
      Otherwise editing a past event quietly loses the room it was held in —
      the form would load with the picker empty and save that.
    */
    const { where } = await queried({ eventId: 'ev-1' });

    const attached = where.OR.find((clause: any) => clause.eventId === 'ev-1');
    expect(attached).toEqual({ eventId: 'ev-1' });
    expect(attached).not.toHaveProperty('endTime');
  });

  it('orders by room first, then by when it starts', async () => {
    // A member picking a room is looking for a room: all the Attic's together,
    // in the order they happen.
    const { orderBy } = await queried();

    expect(orderBy).toEqual([{ room: { name: 'asc' } }, { startTime: 'asc' }]);
  });

  it('still refuses the co-op holds and anything cancelled', async () => {
    // An imported hold is nobody's to publish (SPC-23).
    const { where } = await queried();

    expect(where.isCoopHold).toBe(false);
    expect(where.status).toEqual({ in: ['PENDING', 'APPROVED'] });
  });

  it('still scopes to this co-op and to whose bookings they are', async () => {
    const { where } = await queried();

    expect(where.room).toEqual({ orgId: ORG });
    expect(where.userId).toEqual({ in: expect.arrayContaining(['u-me']) });
  });
});
