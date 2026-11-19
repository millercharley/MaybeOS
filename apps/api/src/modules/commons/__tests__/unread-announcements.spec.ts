import { Test, TestingModule } from '@nestjs/testing';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';
import { ThreadsService } from '../threads.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../platform/audit.service';
import { EmailService } from '../../email/email.service';
import { ConfigService } from '@nestjs/config';

/**
 * #Events and #Teaching do not light up for everybody (CMN-22).
 *
 * Charley: "For a non-host of an event or teaching session: only events that
 * you RSVP'd and/or your messages that get replies should signal a new
 * message alert."
 *
 * Without this, every published event lands in #Events and counts for every
 * member — a badge that never clears and that none of them asked for. CMN-25
 * made the same argument from the other direction, about counting a co-op's
 * whole history.
 */
const ORG = 'org-1';
const USER = 'user-1';

const CHANNELS = [
  { id: 'c-general', slug: 'general' },
  { id: 'c-events', slug: 'events' },
  { id: 'c-teaching', slug: 'teaching' },
];

const build = async (staked: { id: string }[] = []) => {
  const prisma = {
    channel: { findMany: jest.fn().mockResolvedValue(CHANNELS) },
    channelRead: { findMany: jest.fn().mockResolvedValue([]) },
    userOrg: {
      findFirst: jest.fn().mockResolvedValue({ memberSince: new Date('2026-01-01') }),
    },
    post: {
      findMany: jest.fn().mockResolvedValue(staked),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    comment: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CommonsService,
      { provide: PrismaService, useValue: prisma },
      { provide: ThreadsService, useValue: { unreadMessages: jest.fn().mockResolvedValue(0) } },
      { provide: StorageService, useValue: {} },
      { provide: AuditService, useValue: {} },
      { provide: EmailService, useValue: { sendThreadReply: jest.fn() } },
      { provide: ConfigService, useValue: { get: jest.fn(() => 'http://localhost:3000') } },
    ],
  }).compile();

  return { service: module.get(CommonsService), prisma };
};

describe('what the announcement channels count', () => {
  /**
   * A brand-new event cannot have an RSVP yet, so by Charley's rule there is
   * nobody with a stake in it. It appears in the channel for people who go
   * looking, and nothing lights up.
   */
  it('counts no new posts in #Events or #Teaching, for anybody', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const where = prisma.post.groupBy.mock.calls[0][0].where;
    const counted = where.OR.flatMap((clause: { channelId: { in: string[] } }) => clause.channelId.in);

    expect(counted).toContain('c-general');
    expect(counted).not.toContain('c-events');
    expect(counted).not.toContain('c-teaching');
  });

  /** An ordinary channel is untouched by any of this. */
  it('still counts new posts everywhere else', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const where = prisma.post.groupBy.mock.calls[0][0].where;
    expect(where.OR.some((c: { channelId: { in: string[] } }) => c.channelId.in.includes('c-general'))).toBe(true);
  });

  it('asks once which threads this member has a stake in', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, USER, { isStaff: true });

    expect(prisma.post.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.post.findMany.mock.calls[0][0].where;
    expect(where.channelId.in.sort()).toEqual(['c-events', 'c-teaching']);
  });

  /** All four of Charley's reasons, and nothing that stores them anew. */
  it('counts running it, going to it, asking about it and writing in it', async () => {
    const { service, prisma } = await build();
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const or = JSON.stringify(prisma.post.findMany.mock.calls[0][0].where.OR);

    expect(or).toContain('hostId');
    expect(or).toContain('coHosts');
    expect(or).toContain('teacherId');
    expect(or).toContain('rsvps');
    expect(or).toContain('interests');
    expect(or).toContain('comments');
  });

  it('counts replies only in the threads it found a stake in', async () => {
    const { service, prisma } = await build([{ id: 'p-mine' }]);
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const or = prisma.comment.findMany.mock.calls[0][0].where.OR;
    const announcing = or.filter((c: { postId?: unknown }) => c.postId !== undefined);

    expect(announcing).toHaveLength(1);
    expect(announcing[0].postId).toEqual({ in: ['p-mine'] });
  });

  /**
   * The failure mode a negation would have introduced: with no stake
   * anywhere, "not in the staked list" is every thread in the channel. An
   * `in: []` says what is meant — none of them.
   */
  it('counts nothing in those channels for a member with no stake at all', async () => {
    const { service, prisma } = await build([]);
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const or = prisma.comment.findMany.mock.calls[0][0].where.OR;
    const announcing = or.filter((c: { postId?: unknown }) => c.postId !== undefined);

    expect(announcing[0].postId).toEqual({ in: [] });
  });

  it('leaves replies in ordinary channels alone', async () => {
    const { service, prisma } = await build([]);
    await service.unreadCounts(ORG, USER, { isStaff: true });

    const or = prisma.comment.findMany.mock.calls[0][0].where.OR;
    const ordinary = or.filter((c: { postId?: unknown }) => c.postId === undefined);

    expect(ordinary).toHaveLength(1);
    expect(ordinary[0].post.channelId.in).toEqual(['c-general']);
  });

  /** A co-op with neither channel pays nothing for any of this. */
  it('does not ask about stakes when the co-op has no such channels', async () => {
    const prisma = {
      channel: { findMany: jest.fn().mockResolvedValue([{ id: 'c-general', slug: 'general' }]) },
      channelRead: { findMany: jest.fn().mockResolvedValue([]) },
      userOrg: { findFirst: jest.fn().mockResolvedValue({ memberSince: new Date('2026-01-01') }) },
      post: { findMany: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      comment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: { unreadMessages: jest.fn().mockResolvedValue(0) } },
        { provide: StorageService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: EmailService, useValue: { sendThreadReply: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'http://localhost:3000') } },
      ],
    }).compile();

    await module.get(CommonsService).unreadCounts(ORG, USER, { isStaff: true });

    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });
});
