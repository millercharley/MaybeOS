import { Test, TestingModule } from '@nestjs/testing';
import { EventsService } from '../events.service';
import { PrismaService } from '../../../config/prisma.service';
import { ConnectService } from '../../stripe/connect.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * A published event announces itself in the Commons (EVT-23).
 *
 * Charley made an event, went to #Events, and found nothing. That was the
 * design: the thread was created the first time somebody opened an event's
 * discussion, so the Commons only ever heard about events people were already
 * talking about. Announcing is now the point.
 *
 * The two refusals are the part worth testing hardest. A draft has not been
 * told to anybody yet, and a private event — "Just me for now" — must not be
 * posted into a channel every member reads. Both were easy to get wrong in
 * the direction that leaks.
 */
describe('EventsService — announcing an event', () => {
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
        { provide: ConnectService, useValue: {} },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
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

  it('posts the event into the Commons when it goes live', async () => {
    await publish();

    expect(prisma.channel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId_slug: { orgId: ORG, slug: 'events' } } }),
    );
    const { data } = (prisma.post.create as jest.Mock).mock.calls[0][0];
    expect(data.title).toBe('Repair Café');
    // Somewhere to click through to, which an announcement needs and a thread
    // opened from the event page did not.
    expect(data.body).toContain('/portal/sunrise/events/2026-10-01-repair-cafe');
  });

  it('posts under the host, not whoever pressed publish', async () => {
    // An organiser publishing on somebody's behalf should not appear to be
    // running their event.
    await publish();

    const { data } = (prisma.post.create as jest.Mock).mock.calls[0][0];
    expect(data.authorId).toBe(HOST);
  });

  it('says nothing about a private event', async () => {
    // "Just me for now" is the member's own answer about who can see it, and
    // #Events is read by the whole co-op.
    await publish({ visibility: 'PRIVATE' });

    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('escapes a title that contains markup', async () => {
    await publish({ title: '<img src=x onerror=alert(1)>' });

    const { data } = (prisma.post.create as jest.Mock).mock.calls[0][0];
    expect(data.body).not.toContain('<img');
    expect(data.body).toContain('&lt;img');
  });

  it('announces a newly created event that is already published', async () => {
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

    expect(prisma.post.create).toHaveBeenCalled();
  });

  it('says nothing about a draft', async () => {
    const draft = madeEvent({ isPublished: false });
    prisma.event.create.mockResolvedValue(draft as never);
    prisma.event.findFirst.mockResolvedValue(draft as never);

    await service.create(
      ORG,
      {
        title: 'Half-written',
        startTime: '2026-10-01T18:00:00.000Z',
        endTime: '2026-10-01T20:00:00.000Z',
      } as never,
      HOST,
      {},
    );

    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('does not post twice for an event that already has a thread', async () => {
    await publish({ postId: 'post-existing' });

    expect(prisma.post.create).not.toHaveBeenCalled();
  });

  it('still publishes the event when the Commons write fails', async () => {
    // The event is the thing that must exist. Losing an announcement is a
    // smaller harm than refusing to publish what somebody wrote.
    prisma.channel.upsert.mockRejectedValue(new Error('Commons unavailable'));

    await expect(publish()).resolves.toMatchObject({ id: 'event-1' });
  });
});
