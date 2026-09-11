import { NotFoundException } from '@nestjs/common';
import { MemberProfileService, excerpt } from '../member-profile.service';

/**
 * The card that opens on a member's name, anywhere in MaybeOS (MEM-18).
 *
 * It is on every page, so what it must never carry matters more than what it
 * shows: no address for anyone, no hidden member's details for a member, and
 * nothing from an event's conversation.
 */
describe('excerpt', () => {
  it('turns rich text into plain text', () => {
    expect(excerpt('<p>Kiln <strong>firing</strong> tonight &amp; tomorrow</p>')).toBe(
      'Kiln firing tonight & tomorrow',
    );
  });

  it('shortens long bodies with an ellipsis', () => {
    expect(excerpt('word '.repeat(100), 20)).toMatch(/…$/);
    expect(excerpt('word '.repeat(100), 20).length).toBeLessThanOrEqual(20);
  });

  it('is empty for nothing', () => {
    expect(excerpt(null)).toBe('');
  });
});

describe('MemberProfileService', () => {
  const ORG = 'org-1';
  const MEMBER = { userId: 'viewer', privileged: false };
  const ORGANISER = { userId: 'viewer', privileged: true };

  let prisma: any;
  let service: MemberProfileService;

  const membership = (over: Record<string, unknown> = {}) => ({
    userId: 'u-ada',
    role: 'MEMBER',
    isPublic: true,
    memberSince: new Date('2025-02-15T00:00:00Z'),
    headline: 'Potter',
    bio: 'I make bowls.',
    location: 'Louisville, KY',
    tags: ['ceramics'],
    links: ['https://www.instagram.com/ada', 'javascript:alert(1)'],
    user: { id: 'u-ada', name: 'Ada', avatarUrl: null, avatarPath: null },
    org: { slug: 'mif' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      userOrg: { findUnique: jest.fn().mockResolvedValue(membership()) },
      post: {
        count: jest.fn().mockResolvedValue(4),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            title: 'Kiln night',
            body: '<p>Bring clay</p>',
            createdAt: new Date('2026-09-01T00:00:00Z'),
            channel: { id: 'c1', name: 'general' },
          },
        ]),
      },
      comment: {
        count: jest.fn().mockResolvedValue(13),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'k1',
            body: 'Count me in',
            createdAt: new Date('2026-09-08T00:00:00Z'),
            post: { id: 'p9', title: null, body: 'Who is coming?', channel: { id: 'c1', name: 'general' } },
          },
        ]),
      },
    };
    service = new MemberProfileService(prisma);
  });

  it('refuses somebody who is not a member of this co-op', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(null);
    await expect(service.getProfile(ORG, 'u-x', MEMBER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never selects or returns an email address, for anyone', async () => {
    const result = await service.getProfile(ORG, 'u-ada', ORGANISER);

    expect(prisma.userOrg.findUnique.mock.calls[0][0].select.user.select).not.toHaveProperty('email');
    expect(JSON.stringify(result)).not.toMatch(/"email"/);
  });

  it('shows everything a member wrote for this co-op, and counts what they posted', async () => {
    const result: any = await service.getProfile(ORG, 'u-ada', MEMBER);

    expect(result.bio).toBe('I make bowls.');
    expect(result.counts).toEqual({ posts: 4, comments: 13 });
    expect(result.posts[0]).toMatchObject({ id: 'p1', title: 'Kiln night', excerpt: 'Bring clay' });
    expect(result.comments[0].post.excerpt).toBe('Who is coming?');
  });

  it('drops a link that is not http or https', async () => {
    const result: any = await service.getProfile(ORG, 'u-ada', MEMBER);
    expect(result.links).toEqual(['https://www.instagram.com/ada']);
  });

  it('dates "last posted" from the newest post or comment', async () => {
    const result: any = await service.getProfile(ORG, 'u-ada', MEMBER);
    expect(result.lastPostedAt).toEqual(new Date('2026-09-08T00:00:00Z'));
  });

  it('leaves event conversations out of both lists and both counts', async () => {
    await service.getProfile(ORG, 'u-ada', MEMBER);

    expect(prisma.post.count.mock.calls[0][0].where.eventThread).toEqual({ is: null });
    expect(prisma.post.findMany.mock.calls[0][0].where.eventThread).toEqual({ is: null });
    expect(prisma.comment.count.mock.calls[0][0].where.post.eventThread).toEqual({ is: null });
    expect(prisma.comment.findMany.mock.calls[0][0].where.post.eventThread).toEqual({ is: null });
  });

  it('keeps only this co-op’s posts, never another one’s', async () => {
    await service.getProfile(ORG, 'u-ada', MEMBER);
    expect(prisma.post.findMany.mock.calls[0][0].where.channel).toEqual({ orgId: ORG });
  });

  it('gives a member only a name and a face for somebody who hid their profile', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(membership({ isPublic: false }));
    const result: any = await service.getProfile(ORG, 'u-ada', MEMBER);

    expect(result.restricted).toBe(true);
    expect(result.isHidden).toBe(false);
    expect(result).not.toHaveProperty('bio');
    expect(result).not.toHaveProperty('posts');
    expect(prisma.post.findMany).not.toHaveBeenCalled();
  });

  it('shows organisers a hidden member in full, and says they are hidden', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(membership({ isPublic: false }));
    const result: any = await service.getProfile(ORG, 'u-ada', ORGANISER);

    expect(result.restricted).toBe(false);
    expect(result.isHidden).toBe(true);
    expect(result.bio).toBe('I make bowls.');
  });

  it('always shows you your own card', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(membership({ isPublic: false }));
    const result: any = await service.getProfile(ORG, 'viewer', MEMBER);

    expect(result.isYou).toBe(true);
    expect(result.restricted).toBe(false);
  });
});
