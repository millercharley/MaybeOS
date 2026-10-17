import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnnouncementService } from '../announcement.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { AuditService } from '../../platform/audit.service';

/**
 * Emailing a Commons post to the whole roster, as the service runs it
 * (CMN-21).
 *
 * The rules are tested as pure functions beside this file; these assert the
 * service calls them, and the two things only the service can get wrong: the
 * order of the send and its receipt, and whether a second pass repeats
 * anybody.
 */
const POST = {
  id: 'post-1',
  title: 'Potluck is tomorrow',
  body: '<p>Bring a dish. <script>steal()</script></p>',
  channelId: 'chan-1',
  emailRequestedAt: null as Date | null,
  isFlagged: false,
  author: { name: 'Charley' },
  channel: {
    org: { name: 'MaybeItsFate', slug: 'maybeitsfate', replyToEmail: 'hello@maybeitsfate.com' },
  },
};

function build(
  over: { post?: unknown; members?: unknown[]; sends?: Array<{ userOrgId: string }>; sendFails?: boolean } = {},
) {
  const members =
    over.members ??
    [
      {
        id: 'm-ruth',
        userId: 'ruth',
        altEmail: null,
        emailOptIn: null,
        announcementEmails: true,
        user: { email: 'ruth@outlook.com' },
      },
    ];

  const prisma = {
    post: {
      findFirst: jest.fn().mockResolvedValue(over.post === undefined ? POST : over.post),
      update: jest.fn().mockResolvedValue({}),
    },
    userOrg: { findMany: jest.fn().mockResolvedValue(members) },
    postEmailSend: {
      findMany: jest.fn().mockResolvedValue(over.sends ?? []),
      create: jest.fn().mockResolvedValue({}),
    },
  };

  const sendAnnouncement = jest.fn(
    over.sendFails ? () => Promise.reject(new Error('Postmark is down')) : () => Promise.resolve(),
  );
  const record = jest.fn().mockResolvedValue(undefined);

  return { prisma, sendAnnouncement, record };
}

async function service(parts: ReturnType<typeof build>) {
  const module = await Test.createTestingModule({
    providers: [
      AnnouncementService,
      { provide: PrismaService, useValue: parts.prisma },
      { provide: EmailService, useValue: { sendAnnouncement: parts.sendAnnouncement } },
      { provide: AuditService, useValue: { record: parts.record } },
      {
        provide: ConfigService,
        useValue: {
          get: (k: string) => (k === 'JWT_SECRET' ? 'a'.repeat(32) : 'https://maybeos.org'),
        },
      },
    ],
  }).compile();
  return module.get(AnnouncementService);
}

describe('emailing a post to everybody', () => {
  it('writes to a member and reports the pass', async () => {
    const parts = build();
    const out = await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

    expect(out).toEqual({ sent: 1, total: 1, remaining: 0 });
    expect(parts.sendAnnouncement).toHaveBeenCalledTimes(1);
    const [to, payload] = parts.sendAnnouncement.mock.calls[0];
    expect(to).toEqual({ primary: 'ruth@outlook.com', also: null });
    expect(payload.subject).toBe('Potluck is tomorrow');
    expect(payload.replyTo).toBe('hello@maybeitsfate.com');
  });

  /** An organiser's HTML goes straight into a mail client. */
  it('sanitises the body before it leaves', async () => {
    const parts = build();
    await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

    const [, payload] = parts.sendAnnouncement.mock.calls[0];
    expect(payload.bodyHtml).not.toContain('<script');
    expect(payload.bodyHtml).not.toContain('steal()');
    expect(payload.bodyHtml).toContain('Bring a dish');
  });

  it('writes the receipt only after the send', async () => {
    const order: string[] = [];
    const parts = build();
    parts.sendAnnouncement.mockImplementation(async () => void order.push('send'));
    parts.prisma.postEmailSend.create.mockImplementation(async () => void order.push('receipt'));

    await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

    expect(order).toEqual(['send', 'receipt']);
  });

  describe('when the provider fails', () => {
    it('leaves no receipt, so the next pass tries again', async () => {
      const parts = build({ sendFails: true });
      const out = await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(parts.prisma.postEmailSend.create).not.toHaveBeenCalled();
      expect(out.sent).toBe(0);
      expect(out.remaining).toBe(1);
    });

    it('does not fail the whole pass for one member', async () => {
      const parts = build({
        members: [
          { id: 'a', userId: 'a', altEmail: null, emailOptIn: null, announcementEmails: true, user: { email: 'a@x.org' } },
          { id: 'b', userId: 'b', altEmail: null, emailOptIn: null, announcementEmails: true, user: { email: 'b@x.org' } },
        ],
      });
      parts.sendAnnouncement
        .mockRejectedValueOnce(new Error('one bad address'))
        .mockResolvedValue(undefined);

      const out = await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(out.sent).toBe(1);
      expect(out.remaining).toBe(1);
    });
  });

  it('never repeats somebody a previous pass already reached', async () => {
    const parts = build({
      members: [
        { id: 'a', userId: 'a', altEmail: null, emailOptIn: null, announcementEmails: true, user: { email: 'a@x.org' } },
        { id: 'b', userId: 'b', altEmail: null, emailOptIn: null, announcementEmails: true, user: { email: 'b@x.org' } },
      ],
      sends: [{ userOrgId: 'a' }],
    });
    await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

    expect(parts.sendAnnouncement).toHaveBeenCalledTimes(1);
    expect(parts.sendAnnouncement.mock.calls[0][0].primary).toBe('b@x.org');
  });

  it('respects a member who turned announcements off', async () => {
    const parts = build({
      members: [
        { id: 'a', userId: 'a', altEmail: null, emailOptIn: null, announcementEmails: false, user: { email: 'a@x.org' } },
      ],
    });
    await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

    expect(parts.sendAnnouncement).not.toHaveBeenCalled();
  });

  describe('the record of it', () => {
    it('writes an audit entry the first time, naming who asked', async () => {
      const parts = build();
      await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(parts.record).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          actorId: 'admin-1',
          action: 'commons.post.emailed',
          entityId: 'post-1',
        }),
      );
    });

    it('does not write it again on later passes', async () => {
      const parts = build({ post: { ...POST, emailRequestedAt: new Date('2026-10-17T10:00:00Z') } });
      await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(parts.record).not.toHaveBeenCalled();
      expect(parts.prisma.post.update).not.toHaveBeenCalled();
    });

    it('keeps addresses out of the co-op’s audit log', async () => {
      const parts = build();
      await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(JSON.stringify(parts.record.mock.calls[0][0].metadata)).not.toMatch(/@/);
    });
  });

  describe('refusing', () => {
    it('refuses a post belonging to another co-op (SEC-04)', async () => {
      const parts = build({ post: null });

      await expect(
        (await service(parts)).sendPass('org-1', 'post-1', 'admin-1'),
      ).rejects.toThrow(/No such post/);
      expect(parts.sendAnnouncement).not.toHaveBeenCalled();
    });

    it('refuses a hidden post', async () => {
      const parts = build({ post: { ...POST, isFlagged: true } });

      await expect(
        (await service(parts)).sendPass('org-1', 'post-1', 'admin-1'),
      ).rejects.toThrow(/hidden/);
    });

    it('scopes the lookup by co-op, not by bare id', async () => {
      const parts = build();
      await (await service(parts)).sendPass('org-1', 'post-1', 'admin-1');

      expect(parts.prisma.post.findFirst.mock.calls[0][0].where).toEqual({
        id: 'post-1',
        channel: { orgId: 'org-1' },
      });
    });
  });

  it('counts the audience before anything is sent', async () => {
    const parts = build();
    const out = await (await service(parts)).preview('org-1', 'post-1');

    expect(out).toEqual({ sent: 0, total: 0, remaining: 1, subject: 'Potluck is tomorrow' });
    expect(parts.sendAnnouncement).not.toHaveBeenCalled();
  });
});
