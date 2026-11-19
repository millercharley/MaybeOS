import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { ThreadPostService } from '../../commons/thread-post.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';

/**
 * The gate that decides who gets in, driven end to end (EVT-64).
 *
 * `seats.spec.ts` proves the arithmetic. This proves the service asks it —
 * which is the half that was broken, and the half a pure-function test
 * cannot see. The old `determineRsvpStatus` read `event._count.rsvps`, a
 * count of *rows*, and nothing in the suite noticed when that changed.
 */
describe('RSVPing to an event with a capacity', () => {
  let service: EventsService;
  let prisma: any;

  /** An event capped at 20, with `taken` places already gone. */
  const setUp = (opts: {
    rows: number;
    plusOnesSum: number | null;
    waitlistEnabled?: boolean;
    capacity?: number | null;
  }) => {
    prisma.event.findFirst.mockResolvedValue({
      id: 'e1',
      orgId: 'org-1',
      capacity: opts.capacity === undefined ? 20 : opts.capacity,
      waitlistEnabled: opts.waitlistEnabled ?? false,
      canceledAt: null,
      visibility: 'PUBLIC',
      isPublished: true,
      _count: { rsvps: opts.rows },
    });
    prisma.rsvp.aggregate.mockResolvedValue({
      _count: opts.rows,
      _sum: { plusOnes: opts.plusOnesSum },
    });
  };

  const rsvp = (plusOnes: number) =>
    service.rsvp('org-1', 'e1', 'user-1', { plusOnes } as never);

  beforeEach(async () => {
    prisma = {
      event: { findFirst: jest.fn() },
      rsvp: {
        aggregate: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn((args: any) => Promise.resolve({ id: 'r1', ...args.data })),
        update: jest.fn((args: any) => Promise.resolve({ id: 'r1', ...args.data })),
      },
      userOrg: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConnectService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
        { provide: ThreadPostService, useValue: {} },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('confirms somebody when there is room', async () => {
    setUp({ rows: 5, plusOnesSum: 0 });

    await expect(rsvp(0)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('counts the plus-ones already confirmed, not the rows', async () => {
    /*
      Ten RSVPs holding twenty people on a twenty-place evening. The old
      gate compared 10 >= 20, found room, and admitted an eleventh — which
      is Charley's card exactly: a full event still looking open.
    */
    setUp({ rows: 10, plusOnesSum: 10 });

    await expect(rsvp(0)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts the plus-ones of the party arriving', async () => {
    // One place left, a party of four. The old gate asked only whether a
    // row fitted and let the room go three over.
    setUp({ rows: 19, plusOnesSum: 0 });

    await expect(rsvp(3)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still lets a single person into that last place', async () => {
    setUp({ rows: 19, plusOnesSum: 0 });

    await expect(rsvp(0)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('waitlists the whole party rather than splitting it', async () => {
    setUp({ rows: 19, plusOnesSum: 0, waitlistEnabled: true });

    await expect(rsvp(3)).resolves.toMatchObject({ status: 'WAITLISTED' });
  });

  it('asks the database for the sum rather than counting rows itself', async () => {
    /*
      An aggregate, so a popular evening does not pull every RSVP into a
      write path to answer "is there room".
    */
    setUp({ rows: 5, plusOnesSum: 2 });
    await rsvp(0);

    expect(prisma.rsvp.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'e1', status: 'CONFIRMED' },
        _sum: { plusOnes: true },
      }),
    );
  });

  it('copes with an event nobody has RSVPed to, where the sum is null', async () => {
    // Prisma returns `_sum: { plusOnes: null }` for no rows; unguarded that
    // is NaN, and NaN <= capacity is false, so an empty event would have
    // turned everybody away.
    setUp({ rows: 0, plusOnesSum: null });

    await expect(rsvp(0)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('lets a party of any size into an event with no capacity', async () => {
    setUp({ rows: 500, plusOnesSum: 400, capacity: null });

    await expect(rsvp(9)).resolves.toMatchObject({ status: 'CONFIRMED' });
  });
});
