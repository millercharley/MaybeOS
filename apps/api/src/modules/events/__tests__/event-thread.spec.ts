import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { RadarService } from '../../radar/radar.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * A thread in #Events means a conversation, not a page somebody opened
 * (EVT-42).
 *
 * This file used to assert the opposite. EVT-23 made every published event
 * announce itself, because Charley made an event, went to #Events and found
 * nothing — and the empty-thread cost was named at the time and accepted.
 *
 * It was the whole cost. Of the seven event threads MaybeItsFate had, six
 * carried no comments, and worse, they were not coming from publishing at all:
 * reading an event page created the thread, under the name of whoever read it.
 * Three appeared in one browsing session five days after those events went
 * live, and read to the admin like members had posted about them.
 *
 * So nothing writes to the Commons except a comment. The refusals are still
 * the part worth testing hardest: a private event — "Just me for now" — must
 * never reach a channel every member reads, and that is now checked where the
 * thread is actually made rather than only on the path that no longer exists.
 */
describe('EventsService — when an event reaches the Commons', () => {
  let service: EventsService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const HOST = 'host-1';
  const ADMIN = 'admin-1';

  const madeEvent = (over: Record<string, unknown> = {}) => ({
    id: 'event-1',
    title: 'Repair Café',
    slug: '2026-10-01-repair-cafe',
    postId: null,
    isPublished: true,
    visibility: 'MEMBERS_ONLY',
    hostId: HOST,
    org: { slug: 'sunrise' },
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsService,
        // Radar counts an RSVP toward the member's interests (RDR-01).
        { provide: RadarService, useValue: { recordRsvp: jest.fn() } },
        { provide: ConnectService, useValue: {} },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
            // Whether this co-op asks every event to name a room (SPC-27).
            // It does not, here.
            organization: { findUnique: jest.fn().mockResolvedValue({ requireEventRoom: false }) },
            booking: { count: jest.fn().mockResolvedValue(0) },
            event: {
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn().mockResolvedValue({ count: 1 }),
              findFirst: jest.fn(),
              findUnique: jest.fn().mockResolvedValue(null),
            },
            channel: { upsert: jest.fn().mockResolvedValue({ id: 'channel-events' }) },
            post: { create: jest.fn().mockResolvedValue({ id: 'post-1' }), delete: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<EventsService>(EventsService);
    prisma = module.get(PrismaService);
  });

  /** Publishing an existing draft, which is the simplest way in. */
  const publish = (over: Record<string, unknown> = {}) => {
    const event = madeEvent(over);
    // `loadEventForActor`, then the announcement's own read.
    prisma.event.findFirst.mockResolvedValue(event as never);
    prisma.event.update.mockResolvedValue(event as never);
    return service.publish(ORG, 'event-1', { userId: ADMIN, isStaff: true });
  };

  it('writes nothing to the Commons when an event goes live', async () => {
    await publish();

    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(prisma.channel.upsert).not.toHaveBeenCalled();
  });

  it('writes nothing to the Commons for a new event created already published', async () => {
    const created = madeEvent();
    prisma.event.create.mockResolvedValue(created as never);
    prisma.event.findFirst.mockResolvedValue(created as never);

    await service.create(
      ORG,
      {
        title: 'Repair Café',
        startTime: '2026-10-01T18:00:00.000Z',
        endTime: '2026-10-01T20:00:00.000Z',
      } as never,
      HOST,
      { publish: true },
    );

    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('reads an event’s thread without making one', async () => {
    /*
      The bug this file was rewritten for.

      `eventThread` is what the event page calls on load. When reading and
      creating were the same call, opening a page posted to #Events under the
      name of whoever opened it.
    */
    prisma.event.findFirst.mockResolvedValue({ postId: null } as never);

    await expect(service.eventThread(ORG, 'event-1')).resolves.toEqual({ postId: null });
    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(prisma.channel.upsert).not.toHaveBeenCalled();
  });

  it('makes the thread when somebody actually comments', async () => {
    prisma.event.findFirst.mockResolvedValue(madeEvent() as never);

    await service.ensureEventThread(ORG, 'event-1', HOST);

    expect(prisma.channel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_slug: { orgId: ORG, slug: 'events' } } }),
    );
    const { data } = (prisma.post.create as jest.Mock).mock.calls[0][0];
    expect(data.title).toBe('Repair Café');
    // Somewhere to click through to from the Commons.
    expect(data.body).toContain('/portal/sunrise/events/2026-10-01-repair-cafe');
    expect(data.authorId).toBe(HOST);
  });

  it('refuses to make one for a private event', async () => {
    /*
      "Just me for now" is the member's own answer about who can see it, and
      #Events is read by the whole co-op.

      Announcing already refused this; the path that ran when anybody opened
      the page did not, and that was the path that ran. The check belongs
      where the thread is made.
    */
    prisma.event.findFirst.mockResolvedValue(madeEvent({ visibility: 'PRIVATE' }) as never);

    await expect(service.ensureEventThread(ORG, 'event-1', HOST)).resolves.toEqual({
      postId: null,
    });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('escapes a title that contains markup', async () => {
    prisma.event.findFirst.mockResolvedValue(
      madeEvent({ title: '<img src=x onerror=alert(1)>' }) as never,
    );

    await service.ensureEventThread(ORG, 'event-1', HOST);

    const { data } = (prisma.post.create as jest.Mock).mock.calls[0][0];
    expect(data.body).not.toContain('<img');
    expect(data.body).toContain('&lt;img');
  });

  it('does not make a second thread for an event that already has one', async () => {
    prisma.event.findFirst.mockResolvedValue(madeEvent({ postId: 'post-existing' }) as never);

    await expect(service.ensureEventThread(ORG, 'event-1', HOST)).resolves.toEqual({
      postId: 'post-existing',
    });
    expect(prisma.post.create).not.toHaveBeenCalled();
  });
});
