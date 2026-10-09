import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
import { ThreadsService } from '../threads.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../platform/audit.service';
import { CommonsController } from '../commons.controller';
import { PrismaService } from '../../../config/prisma.service';

/**
 * What has not been read (CMN-14).
 *
 * Charley: "when there's an unread message in the Commons or Messages, a red
 * bubble appears in the navigation panel with a number."
 *
 * The number is the whole feature. A badge that is wrong once is a badge
 * people stop believing, and a badge nobody believes is worse than none —
 * so most of these tests are about it being wrong in a plausible way.
 */
/**
 * A stand-in for the database that actually reads the query.
 *
 * These tests used to mock `count` with a fixed number, so "two channels,
 * two posts each" asserted 4 — which measured the old one-query-per-channel
 * shape, not the answer. Collapsing the queries changed that number without
 * changing a single badge.
 *
 * This interprets the `where` instead: give it rows, and it counts the ones
 * the query actually asks for. It knows nothing about how the clauses are
 * built, so a wrong cutoff or a dropped channel comes out as a wrong total.
 */
interface Row {
  channelId: string;
  authorId: string;
  createdAt: Date;
}

type Clause = {
  channelId?: { in: string[] };
  post?: { channelId: { in: string[] } };
  createdAt?: { gt: Date };
};
type Where = { authorId?: { not: string }; OR?: Clause[] };

function countRows(rows: Row[], where: Where): number {
  return rows.filter((row) => {
    if (where.authorId?.not !== undefined && row.authorId === where.authorId.not) return false;

    return (where.OR ?? []).some((clause) => {
      const ids = clause.channelId?.in ?? clause.post?.channelId.in ?? [];
      if (!ids.includes(row.channelId)) return false;
      if (clause.createdAt && !(row.createdAt > clause.createdAt.gt)) return false;
      return true;
    });
  }).length;
}

describe('CommonsService — unread counts', () => {
  const ORG = 'org-1';
  const ME = 'me';
  const JOINED = new Date('2026-01-01T00:00:00.000Z');

  const build = async (over: {
    dms?: number;
    channels?: { id: string }[];
    reads?: { channelId: string; lastReadAt: Date }[];
    posts?: number;
    comments?: number;
    postRows?: Row[];
    commentRows?: Row[];
    memberSince?: Date | null;
  } = {}) => {
    const prisma = {
      directMessage: {
        count: jest.fn().mockResolvedValue(over.dms ?? 0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      channel: {
        findMany: jest.fn().mockResolvedValue(over.channels ?? [{ id: 'ch-1' }]),
        findFirst: jest.fn().mockResolvedValue({ id: 'ch-1' }),
      },
      channelRead: {
        findMany: jest.fn().mockResolvedValue(over.reads ?? []),
        upsert: jest.fn().mockResolvedValue({}),
      },
      userOrg: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            over.memberSince === null ? null : { memberSince: over.memberSince ?? JOINED },
          ),
      },
      post: {
        count: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve(over.postRows ? countRows(over.postRows, where) : over.posts ?? 0),
        ),
      },
      comment: {
        count: jest.fn(({ where }: { where: Where }) =>
          Promise.resolve(over.commentRows ? countRows(over.commentRows, where) : over.comments ?? 0),
        ),
      },
    };

    const threads = { unreadMessages: jest.fn().mockResolvedValue(over.dms ?? 0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: threads },
        { provide: StorageService, useValue: { deleteAttachment: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    return { service: module.get(CommonsService), prisma, threads };
  };

  it('counts the messages I have not read, across every conversation', async () => {
    const { service, threads } = await build({ dms: 3 });

    expect((await service.unreadCounts(ORG, ME)).messages).toBe(3);
    // Threads, not the dormant `direct_messages` table (CMN-16): a group
    // message counts the same as a one-to-one.
    expect(threads.unreadMessages).toHaveBeenCalledWith(ORG, ME);
  });

  it('adds up posts and comments across every channel', async () => {
    const old = new Date('2025-06-01T00:00:00.000Z');
    const recent = new Date('2026-06-01T00:00:00.000Z');
    const { service } = await build({
      channels: [{ id: 'ch-1' }, { id: 'ch-2' }],
      postRows: [
        { channelId: 'ch-1', authorId: 'someone', createdAt: recent },
        { channelId: 'ch-2', authorId: 'someone', createdAt: recent },
        // Before they joined, so not theirs to catch up on.
        { channelId: 'ch-2', authorId: 'someone', createdAt: old },
      ],
      commentRows: [{ channelId: 'ch-1', authorId: 'someone', createdAt: recent }],
    });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(3);
  });

  it('does not count my own posts — writing is not reading', async () => {
    const recent = new Date('2026-06-01T00:00:00.000Z');
    const { service, prisma } = await build({
      postRows: [
        { channelId: 'ch-1', authorId: ME, createdAt: recent },
        { channelId: 'ch-1', authorId: 'someone', createdAt: recent },
      ],
    });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(1);
    expect(prisma.post.count.mock.calls[0][0].where.authorId).toEqual({ not: ME });
  });

  it('counts from where I last read a channel', async () => {
    const lastReadAt = new Date('2026-09-01T00:00:00.000Z');
    const { service } = await build({
      reads: [{ channelId: 'ch-1', lastReadAt }],
      postRows: [
        { channelId: 'ch-1', authorId: 'someone', createdAt: new Date('2026-09-02T00:00:00.000Z') },
        // After they joined but before they last looked: already seen.
        { channelId: 'ch-1', authorId: 'someone', createdAt: new Date('2026-08-30T00:00:00.000Z') },
      ],
    });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(1);
  });

  it('counts from the day I joined in a channel I have never opened', async () => {
    /*
      The case that decides whether this feature is usable at MaybeItsFate.
      426 members were imported, none of whom has opened the Commons. Counting
      from the beginning of time would greet every one of them with a badge
      covering the co-op's entire history — a number nobody acts on, on a
      badge people then learn to ignore.
    */
    const { service } = await build({
      reads: [],
      postRows: [
        { channelId: 'ch-1', authorId: 'someone', createdAt: new Date('2026-02-01T00:00:00.000Z') },
        { channelId: 'ch-1', authorId: 'someone', createdAt: new Date('2025-02-01T00:00:00.000Z') },
      ],
    });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(1);
  });

  it('uses each channel\'s own line, not one line for all of them', async () => {
    /*
      The bug the collapsed query could plausibly introduce: one cutoff
      applied to every channel. A member who has read ch-1 up to September
      must still see August's posts in ch-2, which they have never opened.
    */
    const read = new Date('2026-09-01T00:00:00.000Z');
    const august = new Date('2026-08-15T00:00:00.000Z');
    const { service } = await build({
      channels: [{ id: 'ch-1' }, { id: 'ch-2' }],
      reads: [{ channelId: 'ch-1', lastReadAt: read }],
      postRows: [
        // Seen: before their line in ch-1.
        { channelId: 'ch-1', authorId: 'someone', createdAt: august },
        // Unseen: ch-2 has never been opened, so the line is the join date.
        { channelId: 'ch-2', authorId: 'someone', createdAt: august },
      ],
    });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(1);
  });

  it('still asks the database only twice, however many channels there are', async () => {
    // CMN-25. The badge was a count per channel for posts and another per
    // channel for comments, from every signed-in page on a sixty-second
    // timer.
    const channels = Array.from({ length: 12 }, (_, i) => ({ id: `ch-${i}` }));
    const { service, prisma } = await build({ channels });

    await service.unreadCounts(ORG, ME);

    expect(prisma.post.count).toHaveBeenCalledTimes(1);
    expect(prisma.comment.count).toHaveBeenCalledTimes(1);
  });

  it('says nothing is unread when the co-op has no channels', async () => {
    const { service, prisma } = await build({ channels: [] });

    expect((await service.unreadCounts(ORG, ME)).commons).toBe(0);
    expect(prisma.post.count).not.toHaveBeenCalled();
  });

  it('only looks at this co-op', async () => {
    // Somebody in two co-ops must not see one co-op's badge on the other's
    // sidebar (CMN-08).
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, ME);

    expect(prisma.channel.findMany.mock.calls[0][0].where.orgId).toBe(ORG);
    expect(prisma.channelRead.findMany.mock.calls[0][0].where.channel.orgId).toBe(ORG);
  });
});

describe('CommonsService — marking things read', () => {
  const ORG = 'org-1';
  const ME = 'me';

  const build = async (channel: { id: string } | null = { id: 'ch-1' }) => {
    const prisma = {
      directMessage: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      channel: {
        findFirst: jest.fn().mockResolvedValue(channel),
        findMany: jest.fn().mockResolvedValue([]),
      },
      channelRead: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
      userOrg: { findFirst: jest.fn().mockResolvedValue({ memberSince: new Date() }) },
      post: { count: jest.fn().mockResolvedValue(0) },
      comment: { count: jest.fn().mockResolvedValue(0) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: { unreadMessages: jest.fn().mockResolvedValue(0) } },
        { provide: StorageService, useValue: { deleteAttachment: jest.fn() } },
        { provide: AuditService, useValue: { record: jest.fn() } },
      ],
    }).compile();
    return { service: module.get(CommonsService), prisma };
  };

  it('writes one row per member per channel, however many times they look', async () => {
    const { service, prisma } = await build();

    await service.markChannelRead(ORG, ME, 'ch-1');

    expect(prisma.channelRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_channelId: { userId: ME, channelId: 'ch-1' } } }),
    );
  });

  it('refuses a channel belonging to another co-op', async () => {
    // A channelId from the request is not to be trusted (SEC-04): without the
    // scope check this would write a read marker across the tenant boundary.
    const { service } = await build(null);

    await expect(service.markChannelRead(ORG, ME, 'someone-elses')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('hands back the new totals, so the badge can settle', async () => {
    const { service } = await build();

    await expect(service.markChannelRead(ORG, ME, 'ch-1')).resolves.toEqual({
      messages: 0,
      commons: 0,
    });
  });
});

/**
 * The controller, because the service's arguments are three strings in a row
 * and crossing two of them type-checks perfectly.
 */
describe('CommonsController — unread routes', () => {
  const service = {
    unreadCounts: jest.fn().mockResolvedValue({ messages: 0, commons: 0 }),
    markChannelRead: jest.fn().mockResolvedValue({ messages: 0, commons: 0 }),
  };
  const controller = new CommonsController(service as never);
  const me = { userId: 'me' } as never;

  beforeEach(() => jest.clearAllMocks());

  it('asks for the counts as the signed-in member', () => {
    controller.unreadCounts('org-1', me);
    expect(service.unreadCounts).toHaveBeenCalledWith('org-1', 'me');
  });

  it('passes the member and the channel the right way round', () => {
    // Written because the first version of this route did not: it called
    // markChannelRead(orgId, channelId, userId) against a signature of
    // (orgId, userId, channelId). Both are strings, so nothing complained —
    // it would have written a read marker for a user id that is a channel.
    controller.markChannelRead('org-1', 'ch-9', me);
    expect(service.markChannelRead).toHaveBeenCalledWith('org-1', 'me', 'ch-9');
  });
});
