import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Repeating an event, and what that does to the rooms (EVT-37).
 *
 * Charley: "for some communities, this means the member might need to also
 * reserve a room(s) on a recurring basis."
 *
 * That is the whole difficulty. A calendar repeat is arithmetic; a room is
 * exclusive, so every date has to be checked against what the building
 * already holds, and a clash has to be said out loud rather than silently
 * dropped or silently double-booked.
 */

describe('repeating an event', () => {
  let service: EventsService;
  let prisma: any;

  const source = {
    id: 'e-1',
    parentEventId: null,
    slug: 'open-studio',
    title: 'Open Studio',
    description: null,
    startTime: new Date('2026-10-06T23:00:00Z'),
    endTime: new Date('2026-10-07T01:00:00Z'),
    timezone: 'America/Kentucky/Louisville',
    visibility: 'MEMBERS_ONLY',
    category: null,
    tags: [],
    capacity: null,
    waitlistEnabled: false,
    hostId: 'u-host',
    hasCost: false,
    suggestedCents: null,
    priceCents: null,
    currency: 'usd',
    maturityLevel: 'ALL_AGES',
    locationId: null,
    roomId: null,
    imageUrl: null,
    imageCredit: null,
    imageCreditUrl: null,
    coHosts: [{ userId: 'u-helper' }],
    rooms: [
      {
        id: 'b-1',
        roomId: 'room-attic',
        startTime: new Date('2026-10-06T23:00:00Z'),
        endTime: new Date('2026-10-07T01:00:00Z'),
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          timezone: 'America/Kentucky/Louisville',
          requireEventRoom: false,
        }),
      },
      event: {
        // Two reads: the guard's, then the whole event. Both scoped to the
        // org, which the tenant-scoping guard insists on.
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'e-1', orgId: 'org-1', hostId: 'u-host' })
          .mockResolvedValue(source),
        findUnique: jest.fn().mockResolvedValue(source),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: `e-${Math.random()}` })),
      },
      eventCoHost: { findMany: jest.fn().mockResolvedValue([]) },
      // Nothing else in the building, unless a test says so.
      booking: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), count: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        EventsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    })
      .compile()
      .catch(() => null);

    service = module ? module.get(EventsService) : (new (EventsService as any)(prisma) as EventsService);
  });

  const actor = { userId: 'u-host', isStaff: true };

  it('says what it would do before doing it', async () => {
    const plan: any = await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 4 }, actor);

    expect(plan.dryRun).toBe(true);
    // Four occurrences counting the one that exists, so three new.
    expect(plan.occurrences).toBe(3);
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('reads back as a sentence somebody can check', async () => {
    const plan: any = await service.repeat(
      'org-1',
      'e-1',
      { frequency: 'WEEKLY', interval: 2, count: 4 },
      actor,
    );

    expect(plan.summary).toBe('4 times, every 2 weeks');
  });

  it('makes the rest as drafts', async () => {
    // A series going live at once would announce fifty-two evenings into the
    // Commons (EVT-23), and an organiser wants to look at the dates first.
    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 3, dryRun: false }, actor);

    expect(prisma.event.create).toHaveBeenCalledTimes(2);
    for (const call of prisma.event.create.mock.calls) {
      expect(call[0].data.isPublished).toBe(false);
    }
  });

  it('hangs them off the first as its children', async () => {
    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 2, dryRun: false }, actor);

    expect(prisma.event.create.mock.calls[0][0].data.parentEventId).toBe('e-1');
  });

  it('carries the co-hosts forward', async () => {
    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 2, dryRun: false }, actor);

    expect(prisma.event.create.mock.calls[0][0].data.coHosts.create).toEqual([
      { userId: 'u-helper', addedById: 'u-host' },
    ]);
  });

  it('holds the room for each one', async () => {
    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 3, dryRun: false }, actor);

    expect(prisma.booking.create).toHaveBeenCalledTimes(2);
    expect(prisma.booking.create.mock.calls[0][0].data.roomId).toBe('room-attic');
  });

  it('counts a date where the room is taken, and does not book it', async () => {
    // The thing an organiser has to be told now rather than in November.
    prisma.booking.findFirst.mockResolvedValue({ id: 'someone-else' });

    const plan: any = await service.repeat(
      'org-1',
      'e-1',
      { frequency: 'WEEKLY', count: 3 },
      actor,
    );

    expect(plan.roomClashes).toBe(2);
  });

  it('still makes the event on a date the room is taken', async () => {
    // Somebody can move it or hold a different room; losing the evening
    // because one Tuesday is busy would be worse.
    prisma.booking.findFirst.mockResolvedValue({ id: 'someone-else' });

    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 3, dryRun: false }, actor);

    expect(prisma.event.create).toHaveBeenCalledTimes(2);
    expect(prisma.booking.create).not.toHaveBeenCalled();
  });

  it('keeps each room’s own offset from the start', async () => {
    // A set-up booking that begins an hour before the event stays an hour
    // before it, every week.
    prisma.event.findFirst
      .mockReset()
      .mockResolvedValueOnce({ id: 'e-1', orgId: 'org-1', hostId: 'u-host' })
      .mockResolvedValue({
      ...source,
      rooms: [
        {
          id: 'b-1',
          roomId: 'room-attic',
          startTime: new Date('2026-10-06T22:00:00Z'),
          endTime: new Date('2026-10-07T01:00:00Z'),
        },
      ],
      });

    await service.repeat('org-1', 'e-1', { frequency: 'WEEKLY', count: 2, dryRun: false }, actor);

    const booked = prisma.booking.create.mock.calls[0][0].data;
    const event = prisma.event.create.mock.calls[0][0].data;
    expect(event.startTime.getTime() - booked.startTime.getTime()).toBe(3_600_000);
  });
});

describe('who may repeat one', () => {
  const controller = readFileSync(join(__dirname, '..', 'events.controller.ts'), 'utf8');

  it('is whoever may edit it, which is not a role', () => {
    const route = controller.slice(controller.indexOf("@Post('orgs/:orgId/events/:eventId/repeat')"));

    expect(route.slice(0, 400)).not.toMatch(/@Roles\(/);
    expect(route).toMatch(/isStaff: isStaff\(user, orgId\)/);
  });
});
