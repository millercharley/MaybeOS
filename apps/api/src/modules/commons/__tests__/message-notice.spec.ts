import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ThreadsService } from '../threads.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';

/**
 * Telling somebody that a message is waiting (CMN-19).
 *
 * The rules are tested as pure functions beside this file, and that is not
 * enough: a rule nobody calls passes every test it has, and this project has
 * shipped that shape before. These assert the service's behaviour — who is
 * written to, when the mark is set, and what happens when the provider is
 * having a bad day.
 */
describe('a message that nobody was told about', () => {
  const ORG = 'org-1';

  function build(
    over: {
      participants?: Array<Record<string, unknown>>;
      memberships?: Array<Record<string, unknown>>;
      sendFails?: boolean;
    } = {},
  ) {
    const participants = over.participants ?? [
      { userId: 'me', lastReadAt: null, notifiedAt: null, user: { name: 'Me', email: 'me@x.org' } },
      {
        userId: 'ruth',
        lastReadAt: null,
        notifiedAt: null,
        user: { name: 'Ruth', email: 'ruth@outlook.com' },
      },
    ];
    const memberships =
      over.memberships ??
      participants.map((p) => ({
        userId: p.userId,
        altEmail: null,
        emailOptIn: null,
        messageEmails: true,
      }));

    const prisma = {
      messageThread: {
        findFirst: jest.fn().mockResolvedValue({ id: 't1', orgId: ORG }),
        update: jest.fn().mockResolvedValue({}),
      },
      threadParticipant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'p1' }),
        findMany: jest.fn().mockResolvedValue(participants),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      threadMessage: {
        create: jest.fn().mockResolvedValue({ id: 'm1', createdAt: new Date() }),
        // `startThread` hands back the thread it just made.
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Me' }) },
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          name: 'MaybeItsFate',
          slug: 'maybeitsfate',
          replyToEmail: 'hello@maybeitsfate.com',
        }),
      },
      userOrg: { findMany: jest.fn().mockResolvedValue(memberships) },
    };

    const sendDirectMessage = jest.fn(
      over.sendFails ? () => Promise.reject(new Error('Postmark is down')) : () => Promise.resolve(),
    );

    return { prisma, sendDirectMessage };
  }

  async function service(parts: ReturnType<typeof build>) {
    const module = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: parts.prisma },
        { provide: EmailService, useValue: { sendDirectMessage: parts.sendDirectMessage } },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();
    return module.get(ThreadsService);
  }

  it('writes to the other person and not to the sender', async () => {
    const parts = build();
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Can you cover Thursday?');

    expect(parts.sendDirectMessage).toHaveBeenCalledTimes(1);
    const [to, payload] = parts.sendDirectMessage.mock.calls[0];
    expect(to).toEqual({ primary: 'ruth@outlook.com', also: null });
    expect(payload.senderName).toBe('Me');
    expect(payload.orgName).toBe('MaybeItsFate');
  });

  it('carries the message itself, which is what Charley asked for', async () => {
    const parts = build();
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Can you cover Thursday?');

    const [, payload] = parts.sendDirectMessage.mock.calls[0];
    expect(payload.message).toBe('Can you cover Thursday?');
    expect(payload.truncated).toBe(false);
  });

  it('points at the conversation and at the way to turn these off', async () => {
    const parts = build();
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

    const [, payload] = parts.sendDirectMessage.mock.calls[0];
    expect(payload.threadUrl).toBe('https://maybeos.org/portal/maybeitsfate/messages/t/t1');
    expect(payload.settingsUrl).toContain('/profile');
  });

  it('carries the co-op’s reply address (EML-03)', async () => {
    const parts = build();
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

    expect(parts.sendDirectMessage.mock.calls[0][1].replyTo).toBe('hello@maybeitsfate.com');
  });

  it('copies a member’s second address (MEM-19)', async () => {
    const parts = build({
      memberships: [
        { userId: 'me', altEmail: null, emailOptIn: null, messageEmails: true },
        { userId: 'ruth', altEmail: 'ruth@forum.example', emailOptIn: null, messageEmails: true },
      ],
    });
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

    expect(parts.sendDirectMessage.mock.calls[0][0]).toEqual({
      primary: 'ruth@outlook.com',
      also: 'ruth@forum.example',
    });
  });

  it('stays quiet when they have already been told and not looked', async () => {
    const parts = build({
      participants: [
        { userId: 'me', lastReadAt: null, notifiedAt: null, user: { name: 'Me', email: 'me@x.org' } },
        {
          userId: 'ruth',
          lastReadAt: null,
          notifiedAt: new Date('2026-10-17T09:00:00Z'),
          user: { name: 'Ruth', email: 'ruth@outlook.com' },
        },
      ],
    });
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'And another thing');

    expect(parts.sendDirectMessage).not.toHaveBeenCalled();
  });

  it('respects a member who has switched these off', async () => {
    const parts = build({
      memberships: [
        { userId: 'me', altEmail: null, emailOptIn: null, messageEmails: true },
        { userId: 'ruth', altEmail: null, emailOptIn: null, messageEmails: false },
      ],
    });
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

    expect(parts.sendDirectMessage).not.toHaveBeenCalled();
  });

  describe('when the provider is having a bad day', () => {
    it('still delivers the message inside MaybeOS', async () => {
      const parts = build({ sendFails: true });

      await expect(
        (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello'),
      ).resolves.toBeTruthy();
      expect(parts.prisma.threadMessage.create).toHaveBeenCalled();
    });

    /**
     * The mark is written after the send, and this is why.
     *
     * Setting it first would mean one failed send silences every later
     * message in the thread: the suppression rule would read the mark, see
     * somebody who had "been told", and stay quiet forever about a
     * conversation they never heard of.
     */
    it('does not mark them as told, so the next message tries again', async () => {
      const parts = build({ sendFails: true });
      await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

      const marks = parts.prisma.threadParticipant.updateMany.mock.calls.filter(
        (call: any[]) => call[0]?.data?.notifiedAt,
      );
      expect(marks).toEqual([]);
    });
  });

  /**
   * Starting a conversation is the case that matters most, and the easiest
   * to miss: there are two ways to write to somebody, and the other person
   * has no reason at all to be looking at a thread that did not exist a
   * moment ago.
   */
  it('writes to them when the message is the one that starts the thread', async () => {
    const parts = build();
    parts.prisma.messageThread.upsert = jest.fn().mockResolvedValue({ id: 't1' });
    parts.prisma.userOrg.findMany = jest
      .fn()
      // First call resolves who is allowed in the thread, second the settings.
      .mockResolvedValueOnce([{ userId: 'me' }, { userId: 'ruth' }])
      .mockResolvedValue([
        { userId: 'me', altEmail: null, emailOptIn: null, messageEmails: true },
        { userId: 'ruth', altEmail: null, emailOptIn: null, messageEmails: true },
      ]);

    await (await service(parts)).startThread(ORG, 'me', {
      userIds: ['ruth'],
      body: 'Are you around on Thursday?',
    } as never);

    expect(parts.sendDirectMessage).toHaveBeenCalledTimes(1);
    expect(parts.sendDirectMessage.mock.calls[0][1].message).toBe('Are you around on Thursday?');
  });

  it('marks them as told once the send has gone', async () => {
    const parts = build();
    await (await service(parts)).sendToThread(ORG, 'me', 't1', 'Hello');

    const marks = parts.prisma.threadParticipant.updateMany.mock.calls.filter(
      (call: any[]) => call[0]?.data?.notifiedAt,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0][0].where).toEqual({ threadId: 't1', userId: 'ruth' });
  });
});
