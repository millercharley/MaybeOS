import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SocialService } from '../social.service';
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

describe('SocialService', () => {
  let service: SocialService;
  let prisma: Record<string, Record<string, jest.Mock>>;
  let meta: { isConfigured: boolean; authUrl: jest.Mock; pagesForCode: jest.Mock; publishToPage: jest.Mock; publishToInstagram: jest.Mock };
  let storage: { uploadSocialImage: jest.Mock };

  let event: Record<string, unknown>;
  let org: Record<string, unknown>;
  let account: Record<string, unknown> | null;
  let memberships: Record<string, { role: string; instagramHandle?: string | null }>;


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
    org = { slug: 'maybeitsfate', name: 'MaybeItsFate', socialSharingEnabled: true };
    account = { pageId: '111', pageName: 'MaybeItsFate', pageToken: seal('page-token'), igUserId: '999', igUsername: 'maybeitsfate' };
    memberships = {
      [HOST]: { role: 'MEMBER', instagramHandle: 'janedoe' },
      'admin-1': { role: 'ADMIN', instagramHandle: 'the.admin' },
    };

    prisma = {
      event: { findFirst: jest.fn(() => Promise.resolve(event)) },
      organization: { findUnique: jest.fn(() => Promise.resolve(org)), update: jest.fn() },
      orgSocialAccount: { findUnique: jest.fn(() => Promise.resolve(account)), upsert: jest.fn(), deleteMany: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
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

  /*
    'who may share' and 'sharing' lived here until SOC-04. Both described a
    member posting their own event, which no longer exists — in the two
    months the feature was live not one member used it. What is below is the
    connection itself, which the co-op's weekly post is built on.
  */

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

/**
 * Disconnecting means disconnected (SOC-02).
 *
 * It removed the account and left `socialSharingEnabled` true. Nothing
 * showed, because the settings screen only offers that toggle while a Page
 * is connected and the product's single Share button was somewhere most
 * people never looked. SOC-02 put that button on every event screen, which
 * would have made a stale flag into a button on every public event that
 * opens a dialog saying there is no Page.
 */
describe('disconnecting a co-op from Meta', () => {
  const ORG_ID = 'org-9';

  const build = () => {
    const prisma = {
      orgSocialAccount: {
        deleteMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      organization: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          socialSharingEnabled: false,
          socialShareMembersByDefault: true,
        }),
      },
      $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    };
    const service = new SocialService(
      prisma as never,
      { isConfigured: false } as never,
      { } as never,
      new ConfigService({ JWT_SECRET: JWT }) as never,
    );
    return { service, prisma };
  };

  it('turns sharing off as well as removing the account', async () => {
    const { service, prisma } = build();

    await service.disconnect(ORG_ID);

    expect(prisma.orgSocialAccount.deleteMany).toHaveBeenCalledWith({ where: { orgId: ORG_ID } });
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      data: { socialSharingEnabled: false },
    });
  });

  it('does both or neither', () => {
    // Removing the Page and leaving the flag is the state this fixes; doing
    // it in two statements is how it would come back.
    const { service, prisma } = build();

    return service.disconnect(ORG_ID).then(() => {
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
