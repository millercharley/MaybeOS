import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Events report attendance as `rsvpCount`.
 *
 * The web has read `event.rsvpCount` since the event pages were built; the API
 * only ever sent Prisma's nested `_count.rsvps`. Every attendee figure in the
 * product — the admin capacity bar, the portal list, the public event page —
 * therefore rendered 0, and the optional `rsvpCount?: number` in the web's
 * types made that look deliberate rather than broken.
 *
 * These tests pin the field's presence and its meaning: a response shaped like
 * Prisma's must come out shaped like the contract, and the number must count
 * confirmed attendees only.
 */
describe('EventsService — rsvpCount', () => {
  let service: EventsService;
  let prisma: {
    event: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock; findUnique: jest.Mock };
    organization: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  const row = (id: string, rsvps: number) => ({
    id,
    title: `Event ${id}`,
    capacity: 20,
    visibility: 'PUBLIC',
    isPublished: true,
    _count: { rsvps },
  });

  beforeEach(async () => {
    prisma = {
      event: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
      },
      organization: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EventsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<EventsService>(EventsService);
  });

  it('sends rsvpCount on the org event list, not a nested _count', async () => {
    prisma.event.findMany.mockResolvedValue([row('a', 6), row('b', 0)]);
    prisma.event.count.mockResolvedValue(2);

    const result = await service.listByOrg('org-1', {});

    expect(result.data[0].rsvpCount).toBe(6);
    expect(result.data[1].rsvpCount).toBe(0);
    // The nested shape is an implementation detail of the query; leaking it is
    // what caused the bug, because the web reads the flat name.
    expect(result.data[0]).not.toHaveProperty('_count');
  });

  it('counts confirmed RSVPs only, so a capacity bar is not overstated', async () => {
    prisma.event.findMany.mockResolvedValue([row('a', 6)]);
    prisma.event.count.mockResolvedValue(1);

    await service.listByOrg('org-1', {});

    const include = prisma.event.findMany.mock.calls[0][0].include;
    expect(include._count.select.rsvps).toEqual({ where: { status: 'CONFIRMED' } });
  });

  it('sends rsvpCount on the public event page too', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org-1', slug: 'sunrise' });
    prisma.event.findUnique.mockResolvedValue(row('a', 4));

    const event = await service.getPublicEventBySlug('sunrise', 'potluck');

    expect(event.rsvpCount).toBe(4);
    expect(event).not.toHaveProperty('_count');
  });

  describe('the detail route', () => {
    const withRsvps = () =>
      prisma.event.findFirst.mockResolvedValue({
        id: 'a',
        title: 'Event a',
        rsvps: [
          { userId: 'user-1', status: 'CONFIRMED', guestEmail: null, note: 'wheelchair' },
          { userId: 'user-2', status: 'CONFIRMED', guestEmail: null, note: null },
          { userId: null, status: 'CANCELED', guestEmail: 'guest@example.com', note: null },
          { userId: 'user-3', status: 'WAITLISTED', guestEmail: null, note: null },
        ],
        room: null,
        location: null,
      });

    const organiser = { userId: 'admin-1', privileged: true };
    const member = { userId: 'user-1', privileged: false };

    it('derives the count from the RSVP list', async () => {
      withRsvps();

      const event = await service.findById('org-1', 'a', organiser);

      expect(event.rsvpCount).toBe(2);
    });

    it('counts everyone even when the list itself is redacted', async () => {
      withRsvps();

      // The headline number is not contact information; who is on the list is.
      const event = await service.findById('org-1', 'a', member);

      expect(event.rsvpCount).toBe(2);
    });

    it('shows an ordinary member only their own RSVP', async () => {
      withRsvps();

      const event = await service.findById('org-1', 'a', member);

      // guestEmail is a raw address and note is what somebody wrote to the
      // organisers; this route was open to every member of the org.
      expect(event.rsvps).toEqual([
        { userId: 'user-1', status: 'CONFIRMED', guestEmail: null, note: 'wheelchair' },
      ]);
    });

    it('gives organisers the whole attendee list', async () => {
      withRsvps();

      const event = await service.findById('org-1', 'a', organiser);

      expect(event.rsvps).toHaveLength(4);
    });
  });
});
