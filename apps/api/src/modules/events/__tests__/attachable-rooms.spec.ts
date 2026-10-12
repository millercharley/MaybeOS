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
      // Whose name this is, for the reservations the migration filed under
      // somebody else (SPC-33).
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Brooke Sullivan Brown' }) },
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
    /*
      An imported hold is nobody's to publish (SPC-23) — with the one
      exception added in SPC-34, where the hold is a hold *because* the
      migration could not tell whose it was, and the title says. So the
      filter moved inside the ownership clause rather than sitting above it.
    */
    const { where } = await queried();

    expect(where.status).toEqual({ in: ['PENDING', 'APPROVED'] });

    const owners = where.AND[0].OR.find((c: { userId?: unknown }) => c.userId);
    expect(owners.isCoopHold).toBe(false);

    /*
      And not above it. A top-level `isCoopHold: false` is ANDed with
      everything, so it would silently remove every claimable reservation —
      which is exactly the state this was found in: the title match had been
      written, shipped, and did nothing at all.
    */
    expect(where.isCoopHold).toBeUndefined();
  });

  it('refuses co-op holds outright for an organiser, who is offered everything else', async () => {
    // Nothing is being claimed on their behalf, so the exception does not
    // apply and the old rule stands whole.
    await service.attachableRooms(ORG, { userId: 'u-admin', isOrganiser: true }, {});
    const { where } = prisma.booking.findMany.mock.calls[0][0];

    expect(where.isCoopHold).toBe(false);
    expect(where.AND).toBeUndefined();
  });

  it('still scopes to this co-op and to whose bookings they are', async () => {
    const { where } = await queried();

    expect(where.room).toEqual({ orgId: ORG });
    // Ownership moved under `AND` in SPC-33 so it could sit beside the
    // "free and still to come" clause without replacing it. Still scoped.
    const owners = where.AND[0].OR.find((c: { userId?: unknown }) => c.userId);
    expect(owners.userId).toEqual({ in: expect.arrayContaining(['u-me']) });
  });

  /**
   * Reservations the calendar migration filed under somebody else (SPC-33).
   *
   * Charley booked the Attic and the Library for a member by typing entries
   * on the shared room calendars with her name as the title. Google calls
   * the calendar the organiser of anything created on one, so the importer
   * fell through to the creator — him. 26 upcoming reservations arrived that
   * way, and their owners were told "you have no room bookings near this
   * date. Book the room first", about rooms they already had.
   */
  describe('a reservation that names this member in its title', () => {
    const claimClause = async () => {
      const { where } = await queried();
      return where.AND[0].OR.find((c: { title?: unknown }) => c.title);
    };

    it('is offered to them', async () => {
      expect(await claimClause()).toMatchObject({
        title: { equals: 'Brooke Sullivan Brown', mode: 'insensitive' },
      });
    });

    it('only when the migration put it there', async () => {
      // Narrow on purpose: this offers somebody else's row. An imported
      // entry, still attached to nothing, titled exactly this member's name.
      expect(await claimClause()).toMatchObject({
        googleEventId: { not: null },
        eventId: null,
      });
    });

    it('matches the whole title, not a part of it', async () => {
      // "Natalie Fenton • 3rd Floor Attic" must not match Natalie Fenton —
      // that one already has its owner, and a prefix match would start
      // handing out reservations that merely mention somebody.
      const clause = await claimClause();
      expect(clause.title.contains).toBeUndefined();
      expect(clause.title.startsWith).toBeUndefined();
      expect(clause.title.equals).toBe('Brooke Sullivan Brown');
    });

    it('is not offered when the member has no name to match', async () => {
      prisma.user.findUnique.mockResolvedValue({ name: '  ' });

      const { where } = await queried();
      expect(where.AND[0].OR).toHaveLength(1);
      expect(where.AND[0].OR[0].userId).toBeDefined();
    });

    it('is not asked for at all when an organiser is looking', async () => {
      // They are shown the whole co-op's already.
      await service.attachableRooms(ORG, { userId: 'u-admin', isOrganiser: true }, {});
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
