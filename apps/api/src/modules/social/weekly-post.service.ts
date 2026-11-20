import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { StorageService } from '../storage/storage.service';
import { plainTextOf } from '../../common/plain-text';
import { unseal } from '../../common/secret-box';
import { MetaGraphService } from './meta-graph.service';
import { CAPTION_LIMIT } from './social-caption';
import { buildWeeklyCaption, type CaptionEvent } from './weekly-caption';
import { instantAt, zonedParts } from '../space/availability/zoned-time';
import { isDue, sanitiseSchedule, weeklyWindow } from './weekly-schedule';

/** Facebook allows far more than Instagram; there is no reason to send less. */
const FACEBOOK_CAPTION_LIMIT = 5000;

export interface WeeklyRun {
  considered: number;
  posted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * The co-op's weekly post (SOC-05).
 *
 * Charley: "have the MaybeOS system allow an admin to connect to their
 * Instagram account and/or Facebook Page to generate a weekly post to
 * highlight public events happening at the co-op."
 *
 * Shaped like the monthly recap, which is the nearest thing that already
 * works: the scheduler asks "who is due right now?" every fifteen minutes,
 * and a unique row per `(orgId, periodStart)` is what stops the four runs
 * inside the chosen hour posting four times. The row is claimed *before*
 * anything is published — a claim after the Graph API answers would be a
 * claim that arrives too late to prevent the second post.
 */
@Injectable()
export class WeeklyPostService {
  private readonly logger = new Logger(WeeklyPostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meta: MetaGraphService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  private webUrl(): string {
    return this.config.get<string>('WEB_URL') ?? 'https://maybeos.org';
  }

  /** Every co-op whose hour this is. */
  async runDue(now: Date = new Date()): Promise<WeeklyRun> {
    const accounts = await this.prisma.orgSocialAccount.findMany({
      where: {
        weeklyEnabled: true,
        pageId: { not: null },
        org: { socialSharingEnabled: true },
      },
      include: { org: { select: { id: true, name: true, slug: true, timezone: true, brandColor: true, logoUrl: true } } },
    });

    const run: WeeklyRun = { considered: 0, posted: 0, skipped: 0, failed: 0, errors: [] };

    for (const account of accounts) {
      const schedule = sanitiseSchedule({
        day: account.weeklyDay,
        hour: account.weeklyHour,
        days: account.weeklyDays,
      });
      const timeZone = account.org.timezone || 'America/New_York';
      const parts = zonedParts(now, timeZone);
      if (!isDue(parts, schedule)) continue;

      run.considered += 1;
      try {
        const outcome = await this.postFor(account, parts.date, timeZone, schedule);
        if (outcome === 'posted') run.posted += 1;
        else run.skipped += 1;
      } catch (error) {
        run.failed += 1;
        run.errors.push(`${account.org.slug}: ${(error as Error).message}`);
        this.logger.error(`Weekly post failed for ${account.org.slug}: ${(error as Error).message}`);
      }
    }

    return run;
  }

  private async postFor(
    account: { id: string; orgId: string; pageId: string | null; pageToken: unknown; igUserId: string | null; weeklyCta: string | null; weeklyToPage: boolean; weeklyToInstagram: boolean; org: { id: string; name: string; slug: string; timezone: string; brandColor: string | null; logoUrl: string | null } },
    today: string,
    timeZone: string,
    schedule: { day: number; hour: number; days: number },
  ): Promise<'posted' | 'skipped'> {
    const span = weeklyWindow(today, schedule.days);

    /*
      Local dates become instants here, through `instantAt`, which does the
      two-pass offset dance that gets the mornings the clocks change right.
      `toExclusive` is the day after the last, so the query needs no opinion
      about whether 23:59:59.999 is inside the span.
    */
    const from = instantAt(span.from, 0, timeZone);
    const toExclusive = instantAt(span.toExclusive, 0, timeZone);
    const lastDay = instantAt(span.lastDay, 12 * 60, timeZone);

    const periodStart = new Date(`${span.from}T00:00:00.000Z`);
    const periodEnd = new Date(`${span.lastDay}T00:00:00.000Z`);

    /*
      Claim the week first.

      The unique index refuses the second, third and fourth runs inside the
      hour, and it does so before any of them has asked Facebook for
      anything. Catching the conflict here rather than checking first is
      deliberate: a read-then-write has a gap between the two, and four
      concurrent runs is exactly the shape that finds it.
    */
    let claim;
    try {
      claim = await this.prisma.socialWeeklyPost.create({
        data: { orgId: account.orgId, periodStart, periodEnd },
      });
    } catch {
      return 'skipped';
    }

    const events = await this.publicEventsBetween(account.orgId, from, toExclusive, timeZone);

    /*
      A week with nothing on posts nothing.

      Charley's call: a co-op's feed saying "no events this week" reads worse
      than staying quiet. The row stays, marked EMPTY, so the next run inside
      the same hour still finds the week claimed and does not try again.
    */
    if (events.length === 0) {
      await this.prisma.socialWeeklyPost.update({
        where: { id: claim.id },
        data: { status: 'EMPTY', eventCount: 0 },
      });
      this.logger.log(`Weekly post for ${account.org.slug}: nothing public on, not posting`);
      return 'skipped';
    }

    try {
      const image = await this.renderPoster(account, events, from, lastDay, timeZone);
      const imageUrl = await this.storage.uploadSocialImage(account.orgId, image);

      const caption = (limit: number) =>
        buildWeeklyCaption({
          orgName: account.org.name,
          window: this.windowWords(from, lastDay, timeZone),
          timeZone,
          events,
          eventsUrl: `${this.webUrl()}/orgs/${account.org.slug}/events`,
          cta: account.weeklyCta,
          limit,
        });

      const result: Record<string, string | null> = {};
      const token = unseal<string>(account.pageToken as never);

      if (account.weeklyToPage && account.pageId && token) {
        const fb = await this.meta.publishToPage(
          { id: account.pageId, token },
          {
            message: caption(FACEBOOK_CAPTION_LIMIT),
            link: `${this.webUrl()}/orgs/${account.org.slug}/events`,
            imageUrl,
          },
        );
        result.facebookId = fb.id;
        result.facebookUrl = fb.permalink ?? null;
      }

      if (account.weeklyToInstagram && account.igUserId && token) {
        const ig = await this.meta.publishToInstagram(
          { igUserId: account.igUserId, token },
          { imageUrl, caption: caption(CAPTION_LIMIT) },
        );
        result.instagramId = ig.id;
        result.instagramUrl = ig.permalink ?? null;
      }

      await this.prisma.socialWeeklyPost.update({
        where: { id: claim.id },
        data: { status: 'PUBLISHED', eventCount: events.length, imagePath: imageUrl, ...result },
      });

      this.logger.log(
        `Weekly post for ${account.org.slug}: ${events.length} event(s), ` +
          `${result.facebookId ? 'Facebook' : ''}${result.facebookId && result.instagramId ? ' and ' : ''}${result.instagramId ? 'Instagram' : ''}`,
      );
      return 'posted';
    } catch (error) {
      /*
        The claim stays, marked FAILED, with the reason on it.

        Not deleted: deleting would let the next run inside the same hour try
        again, and a co-op whose token has expired would then be retried four
        times in an hour, every week, for as long as it stayed expired. One
        attempt a week, and an admin who can see why, is the kinder failure.
      */
      await this.prisma.socialWeeklyPost.update({
        where: { id: claim.id },
        data: {
          status: 'FAILED',
          eventCount: events.length,
          error: (error as Error).message.slice(0, 500),
        },
      });
      throw error;
    }
  }

  /** Public, published, not cancelled, inside the window — in time order. */
  private async publicEventsBetween(
    orgId: string,
    from: Date,
    toExclusive: Date,
    _timeZone: string,
  ): Promise<CaptionEvent[]> {
    const rows = await this.prisma.event.findMany({
      where: {
        orgId,
        visibility: 'PUBLIC',
        isPublished: true,
        canceledAt: null,
        startTime: { gte: from, lt: toExclusive },
      },
      orderBy: { startTime: 'asc' },
      select: {
        title: true,
        startTime: true,
        description: true,
        priceCents: true,
        hasCost: true,
        room: { select: { name: true } },
      },
    });

    return rows.map((e) => ({
      title: e.title,
      startsAt: e.startTime,
      room: e.room?.name ?? null,
      free: !e.hasCost && !e.priceCents,
      blurb: e.description ? plainTextOf(e.description) : null,
    }));
  }

  private windowWords(from: Date, to: Date, timeZone: string): string {
    const day = (d: Date) =>
      d.toLocaleDateString('en-US', { timeZone, weekday: 'short', day: 'numeric', month: 'short' });
    return `${day(from)} – ${day(to)}`;
  }

  /**
   * The image, drawn by the web app.
   *
   * Next already ships satori for its OG images, so the drawing costs no new
   * dependency — and the API function is 68 MB and on the compute card. The
   * secret is what makes that route refuse everybody else; without it set,
   * this fails and the week is marked FAILED with the reason, which is the
   * correct outcome for a half-configured install.
   */
  private async renderPoster(
    account: { weeklyCta: string | null; org: { name: string; brandColor: string | null; logoUrl: string | null } },
    events: CaptionEvent[],
    from: Date,
    to: Date,
    timeZone: string,
  ): Promise<Buffer> {
    const secret = this.config.get<string>('POSTER_RENDER_SECRET');
    if (!secret) throw new Error('POSTER_RENDER_SECRET is not set, so the poster cannot be drawn');

    const response = await fetch(`${this.webUrl()}/api/og/weekly`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-poster-secret': secret },
      body: JSON.stringify({
        orgName: account.org.name,
        brandColor: account.org.brandColor,
        logoUrl: account.org.logoUrl,
        cta: account.weeklyCta,
        timezone: timeZone,
        from: from.toISOString(),
        to: to.toISOString(),
        events: events.map((e) => ({
          title: e.title,
          startsAt: e.startsAt.toISOString(),
          room: e.room,
          free: e.free,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`The poster could not be drawn (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
