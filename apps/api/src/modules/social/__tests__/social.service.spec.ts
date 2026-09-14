import { ForbiddenException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialService, DAILY_POST_LIMIT } from '../social.service';
import { MetaApiError } from '../meta-graph.service';
import { encodeState } from '../../../common/oauth-state';
import { isSealed, seal } from '../../../common/secret-box';

/**
 * Who may share a co-op's events to its Facebook and Instagram, and what goes
 * out (SOC-01).
 *
 * There is no approval step, so these rules are the whole of the control.
 */

const ORG = 'org-1';
const EVENT = 'event-1';
const HOST = 'host-1';
const JWT = 'jwt-secret';

function jpeg(width: number, height: number): string {
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.from([0xff, 0xd9])]).toString('base64');
}

describe('SocialService', () => {
  let service: SocialService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let meta: { isConfigured: boolean; authUrl: jest.Mock; pagesForCode: jest.Mock; publishToPage: jest.Mock; publishToInstagram: jest.Mock };
  let storage: { uploadSocialImage: jest.Mock };

  let event: Record<string, unknown>;
  let org: Record<string, unknown>;
  let account: Record<string, unknown> | null;
  let memberships: Record<string, { role: string; socialShareAllowed: boolean | null; instagramHandle?: string | null }>;

  const host = { userId: HOST, staff: false };
  const admin = { userId: 'admin-1', staff: true };

  beforeAll(() => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 5).toString('base64');
  });
  afterAll(() => {
    delete process.env.SECRET_BOX_KEY;
  });

  beforeEach(() => {
    event = {
      id: EVENT,
      orgId: ORG,
      slug: 'art-walk',
      title: 'Art Walk',
      description: 'Meet at the lobby.',
      startTime: new Date(Date.now() + 86_400_000),
      endTime: new Date(Date.now() + 90_000_000),
      timezone: 'America/New_York',
      isPublished: true,
      canceledAt: null,
      visibility: 'PUBLIC',
      hostId: HOST,
      imageUrl: 'https://cdn/event.png',
      location: { name: 'Side Door' },
      host: { name: 'Jane Doe' },
    };
    org = { slug: 'maybeitsfate', name: 'MaybeItsFate', socialSharingEnabled: true, socialShareMembersByDefault: true };
    account = { pageId: '111', pageName: 'MaybeItsFate', pageToken: seal('page-token'), igUserId: '999', igUsername: 'maybeitsfate' };
    memberships = {
      [HOST]: { role: 'MEMBER', socialShareAllowed: null, instagramHandle: 'janedoe' },
      'admin-1': { role: 'ADMIN', socialShareAllowed: null, instagramHandle: 'the.admin' },
    };

    prisma = {
      event: { findFirst: jest.fn(() => Promise.resolve(event)) },
      organization: { findUnique: jest.fn(() => Promise.resolve(org)), update: jest.fn() },
      orgSocialAccount: { findUnique: jest.fn(() => Promise.resolve(account)), upsert: jest.fn(), deleteMany: jest.fn() },
      userOrg: {
        findFirst: jest.fn(({ where }) => Promise.resolve(memberships[where.userId] ?? null)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      eventSocialPost: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'claim-1' }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    meta = {
      isConfigured: true,
      authUrl: jest.fn((state: string) => `https://facebook/dialog?state=${state}`),
      pagesForCode: jest.fn(),
      publishToPage: jest.fn().mockResolvedValue({ id: 'fb-1', permalink: 'https://facebook.com/p/1' }),
      publishToInstagram: jest.fn().mockResolvedValue({ id: 'ig-1', permalink: 'https://instagram.com/p/1', collaboratorInvited: true }),
    };
    storage = { uploadSocialImage: jest.fn().mockResolvedValue('https://cdn/social.jpg') };

    const config = { get: (k: string) => ({ JWT_SECRET: JWT, WEB_URL: 'https://maybeos.org' })[k] } as unknown as ConfigService;
    service = new SocialService(prisma as never, meta as never, storage as never, config);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const share = (actor = host, over: Record<string, unknown> = {}) =>
    service.share(ORG, EVENT, actor, { platforms: ['FACEBOOK', 'INSTAGRAM'], body: 'Come along', image: jpeg(1080, 1350), ...over } as never);

  describe('who may share', () => {
    const reason = async (actor = host) => (await service.shareOptions(ORG, EVENT, actor)).reason;

    it('the host of a published, public, upcoming event, when the co-op allows members by default', async () => {
      expect(await reason()).toBeNull();
    });

    it.each([
      ['sharing is off for the co-op', () => (org.socialSharingEnabled = false), /not turned on/],
      ['no Page is connected', () => (account = null), /not connected/],
      ['the member was switched off', () => (memberships[HOST].socialShareAllowed = false), /turned off for you/],
      ['members are off by default and this one was not switched on', () => (org.socialShareMembersByDefault = false), /turned off for you/],
      ['they are a guest', () => (memberships[HOST].role = 'GUEST'), /Only members/],
      ['they are not the host', () => (event.hostId = 'someone-else'), /Only the host/],
      ['the event is a draft', () => (event.isPublished = false), /Publish the event/],
      ['the event is canceled', () => (event.canceledAt = new Date()), /canceled/],
      ['the event is members-only', () => (event.visibility = 'MEMBERS_ONLY'), /Only public events/],
      ['the event is over', () => (event.endTime = new Date(Date.now() - 1000)), /already happened/],
    ])('not when %s', async (_label, arrange, expected) => {
      arrange();
      expect(await reason()).toMatch(expected);
    });

    it('a member switched on individually, even when the default is off', async () => {
      org.socialShareMembersByDefault = false;
      memberships[HOST].socialShareAllowed = true;
      expect(await reason()).toBeNull();
    });

    it('an admin may share an event they do not host, without being switched on', async () => {
      event.hostId = 'someone-else';
      memberships['admin-1'].socialShareAllowed = false;
      expect(await reason(admin)).toBeNull();
    });

    it('share() enforces the same rules, not only the dialog', async () => {
      event.visibility = 'PRIVATE';
      await expect(share()).rejects.toThrow(ForbiddenException);
      expect(meta.publishToPage).not.toHaveBeenCalled();
    });
  });

  describe('sharing', () => {
    it('posts to both, crediting the host and linking the public event page', async () => {
      const { results } = await share();

      expect(results).toEqual([
        { platform: 'FACEBOOK', ok: true, permalink: 'https://facebook.com/p/1', collaboratorInvited: undefined },
        { platform: 'INSTAGRAM', ok: true, permalink: 'https://instagram.com/p/1', collaboratorInvited: true },
      ]);

      const [page, fb] = meta.publishToPage.mock.calls[0];
      expect(page).toEqual({ id: '111', token: 'page-token' });
      expect(fb.message).toBe(
        'Come along\n\nHosted by Jane Doe (@janedoe on Instagram)\nRSVP: https://maybeos.org/portal/maybeitsfate/events/art-walk',
      );
      expect(fb.imageUrl).toBe('https://cdn/social.jpg');

      const [, ig] = meta.publishToInstagram.mock.calls[0];
      expect(ig).toEqual({
        imageUrl: 'https://cdn/social.jpg',
        caption: 'Come along\n\nHosted by @janedoe\nRSVP: https://maybeos.org/portal/maybeitsfate/events/art-walk',
        collaborator: 'janedoe',
      });
      expect(prisma.eventSocialPost.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: { status: 'PUBLISHED', externalId: 'ig-1', permalink: 'https://instagram.com/p/1' },
      });
    });

    it('credits the host, not the admin who pressed share', async () => {
      await share(admin);
      expect(meta.publishToInstagram.mock.calls[0][1].collaborator).toBe('janedoe');
    });

    it('refuses a picture Instagram would refuse, before anything is posted', async () => {
      await expect(share(host, { image: jpeg(1080, 1920) })).rejects.toThrow(/4:5/);
      await expect(share(host, { image: Buffer.from('not a jpeg').toString('base64') })).rejects.toThrow(/JPEG/);
      expect(storage.uploadSocialImage).not.toHaveBeenCalled();
      expect(meta.publishToPage).not.toHaveBeenCalled();
    });

    it('still posts to Facebook when Instagram has no picture to use', async () => {
      const { results } = await share(host, { image: undefined });
      expect(results[0]).toMatchObject({ platform: 'FACEBOOK', ok: true });
      expect(results[1]).toMatchObject({ platform: 'INSTAGRAM', ok: false, error: expect.stringMatching(/needs a picture/) });
      expect(prisma.eventSocialPost.delete).toHaveBeenCalledWith({ where: { id: 'claim-1' } });
    });

    it('will not post the same event twice', async () => {
      prisma.eventSocialPost.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
      prisma.eventSocialPost.findUnique.mockResolvedValue({ id: 'old', status: 'PUBLISHED', permalink: 'https://facebook.com/p/0', updatedAt: new Date() });

      const { results } = await share(host, { platforms: ['FACEBOOK'] });
      expect(results).toEqual([{ platform: 'FACEBOOK', ok: false, alreadyShared: true, permalink: 'https://facebook.com/p/0', error: 'Already shared.' }]);
      expect(meta.publishToPage).not.toHaveBeenCalled();
    });

    it('frees the slot and asks for a reconnect when the Page token has died', async () => {
      meta.publishToPage.mockRejectedValue(new MetaApiError('Error validating access token', 190));
      const { results } = await share(host, { platforms: ['FACEBOOK'] });
      expect(results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/reconnect/) });
      expect(prisma.eventSocialPost.delete).toHaveBeenCalled();
    });

    it('stops at the daily limit', async () => {
      prisma.eventSocialPost.count.mockResolvedValue(DAILY_POST_LIMIT - 1);
      await expect(share()).rejects.toThrow(HttpException);
      expect(meta.publishToPage).not.toHaveBeenCalled();
    });
  });

  describe('connecting a Page', () => {
    const state = (over: Record<string, unknown> = {}) =>
      encodeState({ orgId: ORG, userId: 'admin-1', issuedAt: Date.now(), flow: 'meta', ...over } as never, JWT);
    const page = (id: string) => ({ id, name: `Page ${id}`, token: `token-${id}`, igUserId: '999', igUsername: 'mif' });

    beforeEach(() => {
      prisma.userOrg.findFirst.mockImplementation(({ where }) =>
        Promise.resolve(where.role === 'ADMIN' && where.userId === 'admin-1' ? { org: { slug: 'maybeitsfate' } } : null),
      );
    });

    it('refuses a state from another flow, such as the calendar’s', async () => {
      await expect(service.handleCallback('code', state({ flow: undefined, roomId: 'room-1' }))).rejects.toThrow(ForbiddenException);
      expect(meta.pagesForCode).not.toHaveBeenCalled();
    });

    it('refuses someone who is no longer an admin', async () => {
      await expect(service.handleCallback('code', state({ userId: 'member-9' }))).rejects.toThrow(ForbiddenException);
    });

    it('connects the only Page, storing its token sealed', async () => {
      meta.pagesForCode.mockResolvedValue([page('111')]);
      expect(await service.handleCallback('code', state())).toEqual({ orgSlug: 'maybeitsfate', outcome: 'connected' });

      const { create } = prisma.orgSocialAccount.upsert.mock.calls[0][0];
      expect(isSealed(create.pageToken)).toBe(true);
      expect(JSON.stringify(create)).not.toContain('token-111');
    });

    it('asks the admin to choose when their login manages several Pages', async () => {
      meta.pagesForCode.mockResolvedValue([page('111'), page('222')]);
      expect((await service.handleCallback('code', state())).outcome).toBe('pick');
      expect(JSON.stringify(prisma.orgSocialAccount.upsert.mock.calls[0][0])).not.toContain('token-');
    });

    it('never returns a token in the status', async () => {
      prisma.orgSocialAccount.findUnique.mockResolvedValue({
        pageId: '111', pageName: 'MaybeItsFate', igUserId: '999', igUsername: 'mif', connectedAt: new Date(),
        pendingPages: seal([page('111'), page('222')]), pendingUntil: new Date(Date.now() + 60_000),
      });
      const status = await service.status(ORG);
      expect(status.pendingPages).toEqual([
        { id: '111', name: 'Page 111', igUsername: 'mif' },
        { id: '222', name: 'Page 222', igUsername: 'mif' },
      ]);
      expect(JSON.stringify(status)).not.toContain('token-');
    });
  });
});
