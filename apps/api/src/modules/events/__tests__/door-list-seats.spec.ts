import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * Why the same name is on the door list twice (EVT-46).
 *
 * Stripe Checkout is created with `quantity: 1` and offers no way to ask for
 * two, so buying two seats means checking out twice — and each purchase
 * writes its own guest RSVP. On *Dog Sees God*, Annette Neblett and James
 * Knowles each did that, so each appears on the list twice under one name.
 *
 * Two identical rows read as a duplicate somebody should tidy away, and a
 * host who tidies one has turned a paying guest's friend away at the door.
 * So the rows stay — two seats are two people and two check-ins — and the
 * list says which seat each row is.
 */
const STAFF = { userId: 'organiser-1', isStaff: true };
const EVENT = 'event-1';

describe('EventsService — seats on the door list', () => {
  let service: EventsService;
  let prisma: {
    event: { findFirst: jest.Mock };
    eventCoHost: { findMany: jest.Mock };
    rsvp: { findMany: jest.Mock };
    attendance: { findMany: jest.Mock };
    ticket: { findMany: jest.Mock };
  };

  const guest = (id: string, name: string, email: string, createdAt: string) => ({
    id,
    userId: null,
    guestName: name,
    guestEmail: email,
    status: 'CONFIRMED',
    plusOnes: 0,
    checkedIn: false,
    checkedInAt: null,
    createdAt: new Date(createdAt),
    user: null,
  });

  beforeEach(async () => {
    prisma = {
      event: {
        findFirst: jest.fn().mockResolvedValue({ id: EVENT, orgId: 'org-1', hostId: 'host-1' }),
      },
      eventCoHost: { findMany: jest.fn().mockResolvedValue([]) },
      rsvp: { findMany: jest.fn().mockResolvedValue([]) },
      attendance: { findMany: jest.fn().mockResolvedValue([]) },
      ticket: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConnectService,
          useValue: { refundEventTickets: jest.fn() },
        },
        { provide: EmailService, useValue: { sendWaitlistPromoted: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('numbers both rows when one address bought twice', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      guest('rsvp-1', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:56:50Z'),
      guest('rsvp-2', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:57:14Z'),
    ]);
    prisma.ticket.findMany.mockResolvedValue([
      { buyerEmail: 'netneb1958@gmail.com' },
      { buyerEmail: 'netneb1958@gmail.com' },
    ]);

    const { expected } = await service.listAttendees('org-1', EVENT, STAFF);

    expect(expected.map((a) => a.seat)).toEqual([
      { n: 1, of: 2 },
      { n: 2, of: 2 },
    ]);
    // Still two rows, because two seats are two arrivals and each gets tapped.
    expect(expected).toHaveLength(2);
  });

  /**
   * "Seat 1 of 1" adds a number to the list without adding a fact to it, and
   * a label on every row is a label nobody reads.
   */
  it('says nothing about somebody holding a single seat', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      guest('rsvp-1', 'Margo Morton', 'margojmorton@gmail.com', '2026-10-17T21:19:37Z'),
    ]);
    prisma.ticket.findMany.mockResolvedValue([{ buyerEmail: 'margojmorton@gmail.com' }]);

    const { expected } = await service.listAttendees('org-1', EVENT, STAFF);

    expect(expected[0].seat).toBeNull();
  });

  /** Stripe returns the address as the buyer typed it, capitals and all. */
  it('matches the buyer however they capitalised their address', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      guest('rsvp-1', 'Annette M Neblett', 'NetNeb1958@Gmail.com', '2026-10-22T15:56:50Z'),
      guest('rsvp-2', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:57:14Z'),
    ]);
    prisma.ticket.findMany.mockResolvedValue([
      { buyerEmail: 'netneb1958@gmail.com' },
      { buyerEmail: 'NETNEB1958@GMAIL.COM' },
    ]);

    const { expected } = await service.listAttendees('org-1', EVENT, STAFF);

    expect(expected.map((a) => a.seat?.of)).toEqual([2, 2]);
  });

  /**
   * A refund is the co-op taking the seat back. Counting it would tell the
   * door to admit two where one was paid for.
   */
  it('does not count refunded tickets', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      guest('rsvp-1', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:56:50Z'),
    ]);

    await service.listAttendees('org-1', EVENT, STAFF);

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventId: EVENT, refundedAt: null } }),
    );
  });

  /** A member RSVP has no guest address to match on and must not be numbered. */
  it('leaves members alone', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      {
        id: 'rsvp-1',
        userId: 'user-1',
        guestName: null,
        guestEmail: null,
        status: 'CONFIRMED',
        plusOnes: 0,
        checkedIn: false,
        checkedInAt: null,
        createdAt: new Date('2026-10-20T12:00:00Z'),
        user: { id: 'user-1', name: 'A Member', avatarUrl: null, avatarPath: null },
      },
    ]);
    prisma.ticket.findMany.mockResolvedValue([{ buyerEmail: 'netneb1958@gmail.com' }]);

    const { expected } = await service.listAttendees('org-1', EVENT, STAFF);

    expect(expected[0].seat).toBeNull();
  });

  /**
   * "Seat 1 of 2" has to mean the first one bought, and mean it again on the
   * next load. The ordering is asked of the database rather than done here,
   * because an unordered `findMany` is not stable between two calls — so
   * dropping this clause would make the two rows swap numbers at random,
   * which is worse than not numbering them at all.
   */
  it('asks for the RSVPs in the order they were made', async () => {
    await service.listAttendees('org-1', EVENT, STAFF);

    expect(prisma.rsvp.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'asc' } }),
    );
  });

  /**
   * And the numbering follows that order rather than the display order: the
   * list is sorted by name afterwards, which is exactly what puts one buyer's
   * two rows next to each other.
   */
  it('numbers along the purchase order, not the sorted order', async () => {
    prisma.rsvp.findMany.mockResolvedValue([
      guest('rsvp-first', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:56:50Z'),
      guest('rsvp-second', 'Annette M Neblett', 'netneb1958@gmail.com', '2026-10-22T15:57:14Z'),
    ]);
    prisma.ticket.findMany.mockResolvedValue([
      { buyerEmail: 'netneb1958@gmail.com' },
      { buyerEmail: 'netneb1958@gmail.com' },
    ]);

    const { expected } = await service.listAttendees('org-1', EVENT, STAFF);

    expect(expected.map((a) => [a.rsvpId, a.seat?.n])).toEqual([
      ['rsvp-first', 1],
      ['rsvp-second', 2],
    ]);
  });
});
