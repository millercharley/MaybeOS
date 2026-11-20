import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import { stripComments } from '../../../common/testing/source-scan';
import { WeeklyPostService } from '../weekly-post.service';
import { seal } from '../../../common/secret-box';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const ORG = 'org-1';

/** 9am on Thursday 26 November 2026 in New York is 14:00 UTC. */
const THURSDAY_9AM = new Date('2026-11-26T14:00:00Z');

describe('the co-op’s weekly post', () => {
  beforeAll(() => {
    process.env.SECRET_BOX_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  function build(over: Record<string, unknown> = {}) {
    const account = {
      id: 'acc-1',
      orgId: ORG,
      pageId: '123',
      pageToken: seal('page-token'),
      igUserId: 'ig-1',
      weeklyEnabled: true,
      weeklyDay: 4,
      weeklyHour: 9,
      weeklyDays: 11,
      weeklyCta: 'Visit example.com/events for tickets and details!',
      weeklyToPage: true,
      weeklyToInstagram: true,
      org: {
        id: ORG,
        name: 'MaybeItsFate',
        slug: 'maybeitsfate',
        timezone: 'America/New_York',
        brandColor: '#afd2e9',
        logoUrl: null,
      },
      ...over,
    };

    const events = (over.events as unknown[]) ?? [
      {
        title: 'Figure drawing',
        startTime: new Date('2026-11-29T23:30:00Z'),
        description: '<p>Bring your own materials</p>',
        priceCents: null,
        hasCost: true,
        room: { name: 'Attic' },
      },
    ];

    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];

    const prisma = {
      orgSocialAccount: { findMany: jest.fn().mockResolvedValue([account]) },
      event: { findMany: jest.fn().mockResolvedValue(events) },
      socialWeeklyPost: {
        create: jest.fn((args: { data: Record<string, unknown> }) => {
          if (over.claimTaken) return Promise.reject(new Error('Unique constraint failed'));
          created.push(args.data);
          return Promise.resolve({ id: 'post-1', ...args.data });
        }),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updated.push(args.data);
          return Promise.resolve({});
        }),
      },
    };

    const meta = {
      publishToPage: jest.fn().mockResolvedValue({ id: 'fb-1', permalink: 'https://fb/1' }),
      publishToInstagram: jest.fn().mockResolvedValue({ id: 'ig-1', permalink: 'https://ig/1' }),
    };

    const storage = { uploadSocialImage: jest.fn().mockResolvedValue('https://cdn/poster.jpg') };

    const config = {
      get: (key: string) =>
        ({ WEB_URL: 'https://maybeos.org', POSTER_RENDER_SECRET: 'shh' } as Record<string, string>)[key],
    } as ConfigService;

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
    });
    global.fetch = fetchMock as never;

    const service = new WeeklyPostService(prisma as never, meta as never, storage as never, config);
    return { service, prisma, meta, storage, created, updated, fetchMock };
  }

  describe('whose hour it is', () => {
    it('posts for a co-op that is due', async () => {
      const { service, meta, updated } = build();

      const run = await service.runDue(THURSDAY_9AM);

      expect(run).toMatchObject({ considered: 1, posted: 1, failed: 0 });
      expect(meta.publishToPage).toHaveBeenCalledTimes(1);
      expect(meta.publishToInstagram).toHaveBeenCalledTimes(1);
      expect(updated[0]).toMatchObject({ status: 'PUBLISHED', eventCount: 1 });
    });

    it('does nothing an hour early', async () => {
      const { service, meta } = build();

      const run = await service.runDue(new Date('2026-11-26T13:00:00Z'));

      expect(run.considered).toBe(0);
      expect(meta.publishToPage).not.toHaveBeenCalled();
    });

    it('does nothing on another day', async () => {
      const { service } = build();
      expect((await service.runDue(new Date('2026-11-27T14:00:00Z'))).considered).toBe(0);
    });

    /*
      The hour is the co-op's own. The same instant is 1am Friday in Sydney,
      and a co-op there is not due — the bug this prevents would post for
      every co-op on earth at 9am UTC.
    */
    it('reads the hour in the co-op’s own timezone', async () => {
      const { service } = build({
        org: {
          id: ORG,
          name: 'Harbour Makers',
          slug: 'harbour',
          timezone: 'Australia/Sydney',
          brandColor: null,
          logoUrl: null,
        },
      });

      expect((await service.runDue(THURSDAY_9AM)).considered).toBe(0);
      // 9am Thursday in Sydney is 22:00 UTC on the Wednesday.
      expect((await service.runDue(new Date('2026-11-25T22:00:00Z'))).considered).toBe(1);
    });
  });

  /**
   * The unique row per week is the whole of the idempotency. The scheduler
   * runs every fifteen minutes, so four runs fall inside the chosen hour.
   */
  describe('posting once', () => {
    it('claims the week before it publishes anything', async () => {
      const { service, prisma, meta } = build();
      await service.runDue(THURSDAY_9AM);

      const claimedAt = (prisma.socialWeeklyPost.create as jest.Mock).mock.invocationCallOrder[0];
      const publishedAt = (meta.publishToPage as jest.Mock).mock.invocationCallOrder[0];
      expect(claimedAt).toBeLessThan(publishedAt);
    });

    it('publishes nothing when the week is already claimed', async () => {
      const { service, meta } = build({ claimTaken: true });

      const run = await service.runDue(THURSDAY_9AM);

      expect(run).toMatchObject({ considered: 1, posted: 0, skipped: 1 });
      expect(meta.publishToPage).not.toHaveBeenCalled();
      expect(meta.publishToInstagram).not.toHaveBeenCalled();
    });

    it('claims the day it goes out, so the next week is a different row', async () => {
      const { service, created } = build();
      await service.runDue(THURSDAY_9AM);

      expect(created[0]).toMatchObject({
        periodStart: new Date('2026-11-26T00:00:00.000Z'),
        periodEnd: new Date('2026-12-06T00:00:00.000Z'),
      });
    });
  });

  describe('what it asks the database for', () => {
    it('wants public, published, uncancelled events inside the co-op’s own days', async () => {
      const { service, prisma } = build();
      await service.runDue(THURSDAY_9AM);

      const { where, orderBy } = (prisma.event.findMany as jest.Mock).mock.calls[0][0];

      expect(where).toMatchObject({ orgId: ORG, visibility: 'PUBLIC', isPublished: true, canceledAt: null });
      // Midnight in New York, not in UTC.
      expect(where.startTime.gte.toISOString()).toBe('2026-11-26T05:00:00.000Z');
      expect(where.startTime.lt.toISOString()).toBe('2026-12-07T05:00:00.000Z');
      expect(orderBy).toEqual({ startTime: 'asc' });
    });
  });

  /** Charley's call: a feed saying "nothing on this week" reads worse than silence. */
  describe('a week with nothing on', () => {
    it('posts nothing and says so on the row', async () => {
      const { service, meta, updated } = build({ events: [] });

      const run = await service.runDue(THURSDAY_9AM);

      expect(run).toMatchObject({ posted: 0, skipped: 1 });
      expect(meta.publishToPage).not.toHaveBeenCalled();
      expect(updated[0]).toMatchObject({ status: 'EMPTY', eventCount: 0 });
    });

    it('still claims the week, so the next run in the hour does not try again', async () => {
      const { service, created } = build({ events: [] });
      await service.runDue(THURSDAY_9AM);
      expect(created).toHaveLength(1);
    });
  });

  describe('which networks', () => {
    it('skips Instagram when the co-op turned it off', async () => {
      const { service, meta } = build({ weeklyToInstagram: false });
      await service.runDue(THURSDAY_9AM);

      expect(meta.publishToPage).toHaveBeenCalled();
      expect(meta.publishToInstagram).not.toHaveBeenCalled();
    });

    it('skips Facebook when the co-op turned it off', async () => {
      const { service, meta } = build({ weeklyToPage: false });
      await service.runDue(THURSDAY_9AM);

      expect(meta.publishToPage).not.toHaveBeenCalled();
      expect(meta.publishToInstagram).toHaveBeenCalled();
    });
  });

  describe('the image', () => {
    it('asks the web app for it, with the secret and the co-op’s own zone', async () => {
      const { service, fetchMock, storage } = build();
      await service.runDue(THURSDAY_9AM);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://maybeos.org/api/og/weekly');
      expect(init.headers['x-poster-secret']).toBe('shh');

      const body = JSON.parse(init.body);
      expect(body.timezone).toBe('America/New_York');
      expect(body.cta).toContain('Visit example.com/events');
      expect(body.events[0].title).toBe('Figure drawing');

      // Instagram fetches the picture itself, so it has to be somewhere public.
      expect(storage.uploadSocialImage).toHaveBeenCalled();
    });
  });

  /**
   * A failure keeps its claim.
   *
   * Deleting it would let the next run inside the same hour try again, so a
   * co-op with an expired token would be retried four times an hour, every
   * week, for as long as it stayed expired.
   */
  describe('when it goes wrong', () => {
    it('records why and does not free the week', async () => {
      const { service, updated, prisma } = build();
      (prisma.socialWeeklyPost.create as jest.Mock).mockResolvedValue({ id: 'post-1' });
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as never;

      const run = await service.runDue(THURSDAY_9AM);

      expect(run.failed).toBe(1);
      expect(updated[0]).toMatchObject({ status: 'FAILED' });
      expect(String(updated[0].error)).toContain('poster');
    });

    it('refuses to draw without the render secret rather than posting something wrong', async () => {
      const { service, updated } = build();
      (service as unknown as { config: { get: (k: string) => string | undefined } }).config = {
        get: (k: string) => (k === 'WEB_URL' ? 'https://maybeos.org' : undefined),
      } as never;

      const run = await service.runDue(THURSDAY_9AM);

      expect(run.failed).toBe(1);
      expect(String(updated[0].error)).toContain('POSTER_RENDER_SECRET');
    });
  });

  /** The decisions live in their own files; this one composes and queries. */
  it('does not hold a second copy of the schedule or the caption', () => {
    const src = stripComments(read('weekly-post.service.ts'));

    expect(src).toMatch(/weeklyWindow\(|isDue\(|sanitiseSchedule\(/);
    expect(src).toMatch(/buildWeeklyCaption\(/);
    // The timezone bridge is the one in space/availability, not a new one.
    expect(src).toMatch(/instantAt\(|zonedParts\(/);
    expect(src).not.toMatch(/getTimezoneOffset|new Intl\.DateTimeFormat/);
  });
});
