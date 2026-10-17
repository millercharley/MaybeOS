import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CommonsDigestService } from '../commons-digest.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * The weekly Commons digest, as the service actually runs it (CMN-20).
 *
 * The rules are tested as pure functions beside this file. These assert that
 * the service calls them — a rule nobody calls passes every test it has, and
 * this project has shipped that shape more than once.
 *
 * The one that matters most: a member who reads the Commons must never get
 * one. Charley chose activity over `lastLoginAt` for exactly that reason.
 */
const NOW = new Date('2026-10-19T09:00:00Z'); // a Monday, 09:00 UTC

const ORG = {
  id: 'org-1',
  name: 'MaybeItsFate',
  slug: 'maybeitsfate',
  timezone: 'UTC',
  replyToEmail: 'hello@maybeitsfate.com',
  commonsDigestDay: 1,
  commonsDigestHour: 9,
};

function build(
  over: {
    orgs?: unknown[];
    posts?: unknown[];
    members?: unknown[];
    channelReads?: Array<{ userId: string }>;
    threadReads?: Array<{ userId: string }>;
    authoredPosts?: Array<{ authorId: string }>;
    comments?: Array<{ authorId: string }>;
  } = {},
) {
  const posts =
    over.posts ??
    [
      {
        id: 'p1',
        channelId: 'c1',
        authorId: 'someone',
        title: 'The Attic is free on Thursdays',
        body: 'From next week.',
        createdAt: new Date('2026-10-17T10:00:00Z'),
        channel: { name: 'Announcements', emoji: null },
        author: { name: 'Charley' },
        _count: { comments: 2 },
      },
    ];

  const members =
    over.members ??
    [
      {
        id: 'm-ruth',
        userId: 'ruth',
        altEmail: null,
        emailOptIn: null,
        commonsDigestEmails: true,
        user: { name: 'Ruth', email: 'ruth@outlook.com', lastLoginAt: null },
      },
    ];

  const prisma = {
    organization: { findMany: jest.fn().mockResolvedValue(over.orgs ?? [ORG]) },
    post: {
      findMany: jest
        .fn()
        // First call is the week's posts; second is the activity sweep.
        .mockResolvedValueOnce(posts)
        .mockResolvedValue(over.authoredPosts ?? []),
    },
    userOrg: { findMany: jest.fn().mockResolvedValue(members), update: jest.fn() },
    channelRead: { findMany: jest.fn().mockResolvedValue(over.channelReads ?? []) },
    threadParticipant: { findMany: jest.fn().mockResolvedValue(over.threadReads ?? []) },
    comment: { findMany: jest.fn().mockResolvedValue(over.comments ?? []) },
  };

  const sendCommonsDigest = jest.fn().mockResolvedValue(undefined);
  return { prisma, sendCommonsDigest };
}

async function service(parts: ReturnType<typeof build>) {
  const module = await Test.createTestingModule({
    providers: [
      CommonsDigestService,
      { provide: PrismaService, useValue: parts.prisma },
      { provide: EmailService, useValue: { sendCommonsDigest: parts.sendCommonsDigest } },
      {
        provide: ConfigService,
        useValue: { get: (k: string) => (k === 'JWT_SECRET' ? 'a'.repeat(32) : 'https://maybeos.org') },
      },
    ],
  }).compile();
  return module.get(CommonsDigestService);
}

describe('sending the weekly Commons digest', () => {
  it('writes to a member who was not here', async () => {
    const parts = build();
    const result = await (await service(parts)).sendDue(NOW);

    expect(result.processed).toBe(1);
    expect(parts.sendCommonsDigest).toHaveBeenCalledTimes(1);
    const [to, payload] = parts.sendCommonsDigest.mock.calls[0];
    expect(to).toEqual({ primary: 'ruth@outlook.com', also: null });
    expect(payload.orgName).toBe('MaybeItsFate');
    expect(payload.channels[0].name).toBe('Announcements');
  });

  describe('a member who was here gets nothing', () => {
    it.each([
      ['opened a channel', { channelReads: [{ userId: 'ruth' }] }],
      ['opened a conversation', { threadReads: [{ userId: 'ruth' }] }],
      ['posted something', { authoredPosts: [{ authorId: 'ruth' }] }],
      ['commented on something', { comments: [{ authorId: 'ruth' }] }],
    ])('because they %s', async (_why, over) => {
      const parts = build(over);
      await (await service(parts)).sendDue(NOW);

      expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
    });

    it('because they signed in', async () => {
      const parts = build({
        members: [
          {
            id: 'm-ruth',
            userId: 'ruth',
            altEmail: null,
            emailOptIn: null,
            commonsDigestEmails: true,
            user: {
              name: 'Ruth',
              email: 'ruth@outlook.com',
              lastLoginAt: new Date('2026-10-18T08:00:00Z'),
            },
          },
        ],
      });
      await (await service(parts)).sendDue(NOW);

      expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
    });
  });

  it('sends nothing at all in a week with no posts', async () => {
    const parts = build({ posts: [] });
    const result = await (await service(parts)).sendDue(NOW);

    expect(result.processed).toBe(0);
    expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
    // And does not go looking for members it has nothing to tell.
    expect(parts.prisma.userOrg.findMany).not.toHaveBeenCalled();
  });

  it('sends nothing when the only posts were the member’s own', async () => {
    const parts = build({
      posts: [
        {
          id: 'p1',
          channelId: 'c1',
          authorId: 'ruth',
          title: 'My own note',
          body: 'Hello',
          createdAt: new Date('2026-10-17T10:00:00Z'),
          channel: { name: 'Announcements', emoji: null },
          author: { name: 'Ruth' },
          _count: { comments: 0 },
        },
      ],
    });
    await (await service(parts)).sendDue(NOW);

    expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
  });

  describe('when it runs', () => {
    it('says nothing on a day the co-op did not choose', async () => {
      const parts = build();
      await (await service(parts)).sendDue(new Date('2026-10-20T09:00:00Z')); // Tuesday

      expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
    });

    it('says nothing in an hour the co-op did not choose', async () => {
      const parts = build();
      await (await service(parts)).sendDue(new Date('2026-10-19T14:00:00Z'));

      expect(parts.sendCommonsDigest).not.toHaveBeenCalled();
    });

    it('only asks the database for co-ops that turned it on', async () => {
      const parts = build();
      await (await service(parts)).sendDue(NOW);

      expect(parts.prisma.organization.findMany.mock.calls[0][0].where).toEqual({
        commonsDigestEnabled: true,
      });
    });
  });

  it('carries an unsubscribe link and the co-op’s reply address', async () => {
    const parts = build();
    await (await service(parts)).sendDue(NOW);

    const [, payload] = parts.sendCommonsDigest.mock.calls[0];
    // The shared page, which lives under /radar and words itself from the token.
    expect(payload.unsubscribeUrl).toContain('/radar/unsubscribe?token=');
    expect(payload.replyTo).toBe('hello@maybeitsfate.com');
  });

  it('marks the member before sending, so a failure cannot repeat every quarter hour', async () => {
    const parts = build();
    await (await service(parts)).sendDue(NOW);

    expect(parts.prisma.userOrg.update).toHaveBeenCalledWith({
      where: { id: 'm-ruth' },
      data: { commonsDigestSentAt: NOW },
    });
  });

  it('asks only for members who have it on and are due', async () => {
    const parts = build();
    await (await service(parts)).sendDue(NOW);

    const where = parts.prisma.userOrg.findMany.mock.calls[0][0].where;
    expect(where.commonsDigestEmails).toBe(true);
    // `emailOptIn` null means never asked, and must not be excluded.
    const optIn = where.AND.find((c: any) => c.OR?.[0]?.emailOptIn !== undefined);
    expect(optIn.OR).toEqual([{ emailOptIn: null }, { emailOptIn: true }]);
  });
});
