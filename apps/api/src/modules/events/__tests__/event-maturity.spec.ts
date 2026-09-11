import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * Who an event is suitable for (SPC-22), and the edit that could not save
 * (EVT-21).
 *
 * `update-event-whitelist.spec.ts` proves the edit form's body gets past the
 * pipe. That is half of it. `update()` names every field it writes, so a field
 * the DTO accepts and the service forgets turns a loud 400 into a quiet
 * nothing — the admin ticks the box, saves, sees no error, and the event is
 * unchanged. These pin the other half.
 */
describe('EventsService — maturity level and cost on edit', () => {
  let service: EventsService;
  let prisma: any;

  const ORG = 'org-1';
  const ORGANISER = { userId: 'user-admin', isStaff: true };
  const dto = {
    title: 'Late show',
    startTime: '2027-04-05T23:00:00.000Z',
    endTime: '2027-04-06T01:00:00.000Z',
  } as never;

  beforeEach(async () => {
    prisma = {
      event: {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'event-1', orgId: ORG, title: 'Late show', startTime: new Date() }),
        update: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
      booking: { findFirst: jest.fn().mockResolvedValue(null) },
      room: {
        findFirst: jest.fn().mockResolvedValue({ id: 'room-1', capacity: 60, locationId: null }),
        findUnique: jest.fn().mockResolvedValue({ id: 'room-1', capacity: 60, locationId: null }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConnectService,
          useValue: {
            refundEventTickets: jest.fn().mockResolvedValue({ attempted: 0, refunded: 0, failed: [] }),
          },
        },
        { provide: EmailService, useValue: { sendWaitlistPromoted: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('writes a cost to attend when an event is edited', async () => {
    // The field the edit form has sent since 2026-09-02 and nothing kept.
    await service.update(ORG, 'event-1', { hasCost: true } as never, ORGANISER);

    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({ hasCost: true });
  });

  it('writes a maturity level when an event is edited', async () => {
    await service.update(ORG, 'event-1', { maturityLevel: 'AGES_21_PLUS' } as never, ORGANISER);

    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      maturityLevel: 'AGES_21_PLUS',
    });
  });

  it('leaves both alone on an edit that does not mention them', async () => {
    // `!== undefined`, not truthiness: an edit to the title must not reset a
    // 21+ event to all ages, or a cost to none.
    await service.update(ORG, 'event-1', { title: 'Later show' } as never, ORGANISER);

    const { data } = prisma.event.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('maturityLevel');
    expect(data).not.toHaveProperty('hasCost');
  });

  it('can set a restricted event back to all ages', async () => {
    await service.update(ORG, 'event-1', { maturityLevel: 'ALL_AGES', hasCost: false } as never, ORGANISER);

    expect(prisma.event.update.mock.calls[0][0].data).toMatchObject({
      maturityLevel: 'ALL_AGES',
      hasCost: false,
    });
  });

  it('keeps the rating a booking carried across', async () => {
    // How publishFromBooking hands it over (EVT-17): as an option, because it
    // comes from the booking row rather than anything the browser sent.
    await service.create(ORG, dto, ORGANISER.userId, { maturityLevel: 'AGES_18_PLUS' });

    expect(prisma.event.create.mock.calls[0][0].data.maturityLevel).toBe('AGES_18_PLUS');
  });

  it('is all ages when nobody said otherwise', async () => {
    await service.create(ORG, dto, ORGANISER.userId);

    expect(prisma.event.create.mock.calls[0][0].data.maturityLevel).toBe('ALL_AGES');
  });

  it('carries a 21+ booking onto the event it is published as', async () => {
    // The path that matters most: the booking's answers travel to the event
    // (EVT-17), and a public event page is where a stranger with a teenager
    // reads it. Dropping the rating here would publish "Late show" to the
    // internet saying nothing about who it is for.
    const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    prisma.booking.findFirst.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-host',
      roomId: 'room-1',
      title: 'Late show',
      description: null,
      startTime: start,
      endTime: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      status: 'APPROVED',
      visibility: 'PUBLIC',
      expectedAttendance: 40,
      hasCost: true,
      categories: ['Social'],
      maturityLevel: 'AGES_21_PLUS',
      room: { id: 'room-1', capacity: 60, locationId: null },
      event: null,
    });

    await service.createFromBooking(ORG, 'booking-1', 'user-host', false, {} as never);

    expect(prisma.event.create.mock.calls[0][0].data.maturityLevel).toBe('AGES_21_PLUS');
  });
});
