import { Test, TestingModule } from '@nestjs/testing';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';
import { ThreadsService } from '../threads.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../platform/audit.service';

/**
 * Where the unread things are, not just how many (CMN-27).
 *
 * Charley: "Why the 2 messages for new messages when no new messages? There's
 * a bug listing new messages in the nav panel."
 *
 * The two were real — an event-discussion post and a comment on it, both in
 * the Events channel. What was broken is that nothing could be done about
 * them: the sidebar said 2, the Commons page gave no hint which channel held
 * them, and opening the Commons marked whichever channel it landed on as
 * read. The number sat there for days while the member was certain they had
 * read everything.
 *
 * A badge nobody can act on is worse than no badge: it teaches people to
 * ignore the one that matters later.
 */
const ORG = 'org-1';
const USER = 'user-1';

describe('CommonsService — unread by channel', () => {
  const build = async (over: {
    channels?: { id: string }[];
    reads?: { channelId: string; lastReadAt: Date }[];
    postGroups?: { channelId: string; _count: { _all: number } }[];
    comments?: { post: { channelId: string } }[];
  } = {}) => {
    const prisma = {
      channel: {
        findMany: jest.fn().mockResolvedValue(
          over.channels ?? [{ id: 'general' }, { id: 'events' }],
        ),
      },
      channelRead: { findMany: jest.fn().mockResolvedValue(over.reads ?? []) },
      userOrg: {
        findFirst: jest.fn().mockResolvedValue({ memberSince: new Date('2026-01-01') }),
      },
      post: { groupBy: jest.fn().mockResolvedValue(over.postGroups ?? []) },
      comment: { findMany: jest.fn().mockResolvedValue(over.comments ?? []) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: { unreadMessages: jest.fn().mockResolvedValue(0) } },
        { provide: StorageService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    return { service: module.get(CommonsService), prisma };
  };

  /** Charley's exact case: one post and one comment, both in Events. */
  it('says which channel the unread things are in', async () => {
    const { service } = await build({
      postGroups: [{ channelId: 'events', _count: { _all: 1 } }],
      comments: [{ post: { channelId: 'events' } }],
    });

    const counts = await service.unreadCounts(ORG, USER);

    expect(counts.commons).toBe(2);
    expect(counts.channels).toEqual({ events: 2 });
  });

  it('keeps the total agreeing with the breakdown', async () => {
    const { service } = await build({
      postGroups: [
        { channelId: 'general', _count: { _all: 3 } },
        { channelId: 'events', _count: { _all: 1 } },
      ],
      comments: [{ post: { channelId: 'general' } }, { post: { channelId: 'announcements' } }],
    });

    const counts = await service.unreadCounts(ORG, USER);

    expect(counts.channels).toEqual({ general: 4, events: 1, announcements: 1 });
    expect(counts.commons).toBe(
      Object.values(counts.channels).reduce((a, b) => a + b, 0),
    );
  });

  /**
   * A co-op with forty channels should not pay for thirty-nine noughts on a
   * payload fetched every sixty seconds by every signed-in page.
   */
  it('leaves out channels with nothing unread', async () => {
    const { service } = await build({
      channels: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      postGroups: [{ channelId: 'b', _count: { _all: 2 } }],
    });

    const counts = await service.unreadCounts(ORG, USER);

    expect(counts.channels).toEqual({ b: 2 });
  });

  it('is empty when there is nothing to read', async () => {
    const { service } = await build();

    const counts = await service.unreadCounts(ORG, USER);

    expect(counts).toMatchObject({ commons: 0, channels: {} });
  });

  it('is empty for a co-op with no channels at all', async () => {
    const { service } = await build({ channels: [] });

    const counts = await service.unreadCounts(ORG, USER);

    expect(counts).toMatchObject({ commons: 0, channels: {} });
  });

  /**
   * Still two queries. The breakdown is what `groupBy` returns anyway — this
   * is fetched on a timer by every signed-in page, and the connection pool is
   * what gives out first (CMN-25).
   */
  it('does not cost more round trips than counting did', async () => {
    const { service, prisma } = await build({
      postGroups: [{ channelId: 'events', _count: { _all: 1 } }],
    });

    await service.unreadCounts(ORG, USER);

    expect(prisma.post.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.comment.findMany).toHaveBeenCalledTimes(1);
  });

  /** Their own writing is not something they need to go and read. */
  it('never counts the member’s own posts or comments', async () => {
    const { service, prisma } = await build();

    await service.unreadCounts(ORG, USER);

    expect(prisma.post.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorId: { not: USER } }) }),
    );
    expect(prisma.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ authorId: { not: USER } }) }),
    );
  });
});
