import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThreadsService } from '../threads.service';
import { PrismaService } from '../../../config/prisma.service';
import {
  MAX_PARTICIPANTS,
  everyone,
  isGroup,
  participantKey,
  recipientProblem,
  threadName,
  unreadIn,
} from '../threads';

/**
 * Conversations with more than two people in them (CMN-16).
 *
 * Charley: "the user can type in one or more members... This can be a group
 * message thread or an individual DM thread."
 *
 * The rules first, because they are where this goes wrong quietly: the same
 * people chosen twice opening two threads, a recipient from another co-op, a
 * group named after the person reading it.
 */
describe('who is in a conversation', () => {
  it('is the same conversation whatever order the names were chosen in', () => {
    // Without this, messaging the same three people twice opens a second
    // thread beside the first, each holding half of what was said.
    expect(participantKey(['c', 'a', 'b'])).toBe(participantKey(['b', 'c', 'a']));
  });

  it('counts a person once, however many times they were picked', () => {
    expect(participantKey(['a', 'b', 'a'])).toBe('a,b');
    expect(everyone('a', ['b', 'a', 'b'])).toEqual(['a', 'b']);
  });

  it('always includes the sender', () => {
    expect(everyone('me', ['you'])).toContain('me');
  });

  it('asks for at least one recipient', () => {
    expect(recipientProblem('me', [], [])).toMatch(/at least one/i);
    // Choosing only yourself is choosing nobody.
    expect(recipientProblem('me', ['me'], ['me'])).toMatch(/at least one/i);
  });

  it('refuses somebody who is not in this co-op', () => {
    // The ids come from the request. Without this check a member of one
    // co-op could open a conversation with somebody they cannot see (CMN-08).
    expect(recipientProblem('me', ['outsider'], [])).toMatch(/not a member/i);
    expect(recipientProblem('me', ['you'], ['you'])).toBeNull();
  });

  it('stops at a size where a channel is the better tool', () => {
    const crowd = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => `u${i}`);
    expect(recipientProblem('me', crowd, crowd)).toMatch(/channel/i);
  });

  it('calls two people a DM and three a group', () => {
    expect(isGroup(2)).toBe(false);
    expect(isGroup(3)).toBe(true);
  });
});

describe('what a conversation is called', () => {
  const people = [
    { userId: 'me', name: 'Charley' },
    { userId: 'r', name: 'Rebecca Norton' },
    { userId: 'e', name: 'Eddie Hickerson' },
  ];

  it('leaves the reader out of it', () => {
    // "Charley, Rebecca" in Charley's own list tells him one thing he knows
    // and one thing he wants.
    expect(threadName(people, 'me')).not.toContain('Charley');
  });

  it('names the other person, for a conversation between two', () => {
    expect(threadName(people.slice(0, 2), 'me')).toBe('Rebecca Norton');
  });

  it('reads as a sentence for a few people', () => {
    expect(threadName(people, 'me')).toBe('Rebecca Norton and Eddie Hickerson');
  });

  it('counts the rest once there are too many to read', () => {
    const crowd = [
      { userId: 'me', name: 'Charley' },
      ...Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, name: `Person ${i}` })),
    ];
    expect(threadName(crowd, 'me')).toBe('Person 0, Person 1, Person 2 and 3 others');
  });

  it('prefers a name somebody gave it', () => {
    expect(threadName(people, 'me', 'Kiln crew')).toBe('Kiln crew');
    expect(threadName(people, 'me', '   ')).toBe('Rebecca Norton and Eddie Hickerson');
  });

  it('does not print an empty name for somebody who has not set one', () => {
    expect(threadName([{ userId: 'me' }, { userId: 'x', name: null }], 'me')).toBe('Someone');
  });
});

describe('what is unread in a conversation', () => {
  const at = (iso: string, senderId: string) => ({ senderId, createdAt: new Date(iso) });

  it('ignores what I wrote myself', () => {
    const messages = [at('2026-10-04T10:00:00Z', 'me'), at('2026-10-04T11:00:00Z', 'you')];
    expect(unreadIn(messages, 'me', null)).toBe(1);
  });

  it('treats a conversation never opened as entirely unread', () => {
    const messages = [at('2026-10-04T10:00:00Z', 'you'), at('2026-10-04T11:00:00Z', 'you')];
    expect(unreadIn(messages, 'me', null)).toBe(2);
  });

  it('counts only what arrived after I last looked', () => {
    const messages = [at('2026-10-04T10:00:00Z', 'you'), at('2026-10-04T12:00:00Z', 'you')];
    expect(unreadIn(messages, 'me', new Date('2026-10-04T11:00:00Z'))).toBe(1);
  });
});

/**
 * The service, where the privacy boundary lives. A thread id in a URL is a
 * guess until it is checked, and what it would otherwise open is somebody
 * else's private conversation.
 */
describe('ThreadsService', () => {
  const ORG = 'org-1';
  const ME = 'me';

  const build = async (over: { thread?: unknown; seat?: unknown; members?: string[] } = {}) => {
    const prisma = {
      messageThread: {
        findFirst: jest.fn().mockResolvedValue(
          over.thread === undefined ? { id: 't1', orgId: ORG, title: null } : over.thread,
        ),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 't1' }),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue({ id: 't1' }),
      },
      threadParticipant: {
        findUnique: jest.fn().mockResolvedValue(over.seat === undefined ? { id: 'p1' } : over.seat),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      threadMessage: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'm1', createdAt: new Date() }),
      },
      userOrg: {
        findMany: jest
          .fn()
          .mockResolvedValue((over.members ?? ['you']).map((userId) => ({ userId }))),
        findFirst: jest.fn().mockResolvedValue({ userId: 'you' }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ThreadsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    return { service: module.get(ThreadsService), prisma };
  };

  it('refuses a conversation the asker is not in', async () => {
    const { service } = await build({ seat: null });

    await expect(service.getThread(ORG, ME, 't1')).rejects.toThrow(ForbiddenException);
  });

  it('refuses a conversation belonging to another co-op', async () => {
    // Scoped by orgId, never by bare id (SEC-04).
    const { service } = await build({ thread: null });

    await expect(service.getThread(ORG, ME, 'someone-elses')).rejects.toThrow(NotFoundException);
  });

  it('will not send into a conversation the sender is not in', async () => {
    const { service, prisma } = await build({ seat: null });

    await expect(service.sendToThread(ORG, ME, 't1', 'hello')).rejects.toThrow(ForbiddenException);
    expect(prisma.threadMessage.create).not.toHaveBeenCalled();
  });

  it('finds the conversation these people already have rather than opening a second', async () => {
    const { service, prisma } = await build({ members: ['a', 'b'] });

    await service.startThread(ORG, ME, { userIds: ['b', 'a'], body: 'hello' });

    // Upsert on the sorted fingerprint is what makes this idempotent.
    const call = prisma.messageThread.upsert.mock.calls[0][0];
    expect(call.where.orgId_participantKey.participantKey).toBe(participantKey([ME, 'a', 'b']));
  });

  it('refuses an empty message', async () => {
    const { service } = await build();

    await expect(
      service.startThread(ORG, ME, { userIds: ['you'], body: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('checks the recipients against the co-op, not against the request', async () => {
    // The caller asks for somebody who is not a member; `userOrg` says so.
    const { service } = await build({ members: [] });

    await expect(
      service.startThread(ORG, ME, { userIds: ['outsider'], body: 'hello' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('will not let somebody open a conversation with themselves', async () => {
    const { service } = await build();

    await expect(service.threadWithUser(ORG, ME, ME)).rejects.toThrow(BadRequestException);
  });

  it('marks the sender as having read what they just wrote', async () => {
    const { service, prisma } = await build();

    await service.sendToThread(ORG, ME, 't1', 'hello');

    expect(prisma.threadParticipant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { threadId: 't1', userId: ME } }),
    );
  });

  it('counts nothing for somebody in no conversations', async () => {
    const { service } = await build();

    await expect(service.unreadMessages(ORG, ME)).resolves.toBe(0);
  });
});
