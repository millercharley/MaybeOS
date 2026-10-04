import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
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
      post: { count: jest.fn().mockResolvedValue(over.posts ?? 0) },
      comment: { count: jest.fn().mockResolvedValue(over.comments ?? 0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CommonsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    return { service: module.get(CommonsService), prisma };
  };

  it('counts the messages addressed to me and not yet opened', async () => {
    const { service, prisma } = await build({ dms: 3 });

    expect((await service.unreadCounts(ORG, ME)).messages).toBe(3);
    expect(prisma.directMessage.count).toHaveBeenCalledWith({
      where: { orgId: ORG, receiverId: ME, readAt: null },
    });
  });

  it('never counts a message I sent as one I have to read', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, ME);

    // The whole filter, verbatim: `receiverId` is what makes this my inbox
    // rather than the co-op's whole mailbag.
    const { where } = prisma.directMessage.count.mock.calls[0][0];
    expect(where.receiverId).toBe(ME);
    expect(where.senderId).toBeUndefined();
  });

  it('adds up posts and comments across every channel', async () => {
    const { service } = await build({
      channels: [{ id: 'ch-1' }, { id: 'ch-2' }],
      posts: 2,
      comments: 1,
    });

    // Two channels, each returning 2 posts and 1 comment.
    expect((await service.unreadCounts(ORG, ME)).commons).toBe(6);
  });

  it('does not count my own posts — writing is not reading', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, ME);

    expect(prisma.post.count.mock.calls[0][0].where.authorId).toEqual({ not: ME });
    expect(prisma.comment.count.mock.calls[0][0].where.authorId).toEqual({ not: ME });
  });

  it('counts from where I last read a channel', async () => {
    const lastReadAt = new Date('2026-09-01T00:00:00.000Z');
    const { service, prisma } = await build({ reads: [{ channelId: 'ch-1', lastReadAt }] });

    await service.unreadCounts(ORG, ME);

    expect(prisma.post.count.mock.calls[0][0].where.createdAt).toEqual({ gt: lastReadAt });
  });

  it('counts from the day I joined in a channel I have never opened', async () => {
    /*
      The case that decides whether this feature is usable at MaybeItsFate.
      426 members were imported, none of whom has opened the Commons. Counting
      from the beginning of time would greet every one of them with a badge
      covering the co-op's entire history — a number nobody acts on, on a
      badge people then learn to ignore.
    */
    const { service, prisma } = await build({ reads: [] });

    await service.unreadCounts(ORG, ME);

    expect(prisma.post.count.mock.calls[0][0].where.createdAt).toEqual({ gt: JOINED });
  });

  it('uses each channel\'s own line, not one line for all of them', async () => {
    const read = new Date('2026-09-01T00:00:00.000Z');
    const { service, prisma } = await build({
      channels: [{ id: 'ch-1' }, { id: 'ch-2' }],
      reads: [{ channelId: 'ch-1', lastReadAt: read }],
    });

    await service.unreadCounts(ORG, ME);

    type CountArg = { where: { channelId: string; createdAt: { gt: Date } } };
    const byChannel = new Map(
      prisma.post.count.mock.calls.map(([arg]: [CountArg]) => [
        arg.where.channelId,
        arg.where.createdAt.gt,
      ]),
    );
    expect(byChannel.get('ch-1')).toEqual(read);
    expect(byChannel.get('ch-2')).toEqual(JOINED);
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
      providers: [CommonsService, { provide: PrismaService, useValue: prisma }],
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
