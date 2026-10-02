import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { encodeUnsubscribe } from '../../common/unsubscribe-token';
import { assertPlanIncludes, planIncludes } from '../../common/plan-features';
import { COUNTED_ROLES } from '../member/member-capacity';
import { instantAt, zonedParts } from '../space/availability/zoned-time';
import { ComposerService } from '../impact/composer.service';
import { ImpactService } from '../impact/impact.service';
import { ServiceService } from '../service/service.service';
import { StripeService } from '../stripe/stripe.service';
import { RecapFigures, money, monthLabel, splitArrivals, worthSending } from './recap-figures';
import { recapFacts } from './recap-composer';

/** Members emailed per run. A big co-op finishes over a few runs. */
const BATCH = 200;

/** How far back the one-time Stripe read goes. A year is what the recap prints. */
const BACKFILL_MONTHS = 13;

export interface RecapRunResult {
  processed: number;
  failed: number;
  errors: string[];
}

/**
 * The monthly recap (RCP-01): what the month just ended added up to, and what
 * a member's dues paid for.
 *
 * Drafted on the 1st and **sent by an organiser**, not by the scheduler
 * (Charley, 2026-10-01). The draft is the automation; the send is a person.
 * A monthly letter to the whole community carrying real money figures is
 * worth one pair of human eyes, and the organiser's own note at the top is
 * usually the part people actually read.
 */
@Injectable()
export class RecapService {
  private readonly logger = new Logger(RecapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly impact: ImpactService,
    private readonly service: ServiceService,
    private readonly stripe: StripeService,
    // The same client that writes impact reports (IMP-23). One key, one
    // model, one place that turns an API failure into a readable sentence.
    private readonly composer: ComposerService,
  ) {}

  // ---------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------

  async settings(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        plan: true,
        timezone: true,
        recapEnabled: true,
        recapDraftHour: true,
        recapShowMoney: true,
        duesBackfilledAt: true,
      },
    });
    if (!org) throw new NotFoundException('Community not found');

    const [subscribed, latest] = await Promise.all([
      this.prisma.userOrg.count({
        where: { orgId, recapEmails: true, role: { in: [...COUNTED_ROLES] } },
      }),
      this.prisma.monthlyRecap.findFirst({
        where: { orgId },
        orderBy: { periodStart: 'desc' },
        select: { id: true, periodStart: true, status: true, sentAt: true, sentCount: true },
      }),
    ]);

    return {
      available: planIncludes(org.plan),
      plan: org.plan,
      enabled: org.recapEnabled,
      draftHour: org.recapDraftHour,
      showMoney: org.recapShowMoney,
      timezone: org.timezone,
      duesBackfilledAt: org.duesBackfilledAt,
      subscribed,
      latest,
    };
  }

  async updateSettings(
    orgId: string,
    changes: { enabled?: boolean; draftHour?: number; showMoney?: boolean },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    if (changes.enabled === true) assertPlanIncludes(org.plan, 'recap');
    if (changes.draftHour !== undefined && (changes.draftHour < 0 || changes.draftHour > 23)) {
      throw new BadRequestException('Pick an hour of the day.');
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(changes.enabled !== undefined && { recapEnabled: changes.enabled }),
        ...(changes.draftHour !== undefined && { recapDraftHour: changes.draftHour }),
        ...(changes.showMoney !== undefined && { recapShowMoney: changes.showMoney }),
      },
    });

    return this.settings(orgId);
  }

  // ---------------------------------------------------------------------
  // The month
  // ---------------------------------------------------------------------

  /**
   * The month that just ended, in the co-op's own calendar.
   *
   * The co-op's timezone rather than UTC: a recap for "September" that
   * includes the evening of 31 August, because the co-op is five hours behind
   * UTC, is wrong in the way nobody checks — the numbers look plausible and
   * the event everyone remembers is filed under the wrong month.
   */
  private previousMonth(timezone: string, now: Date): { start: Date; end: Date; label: string } {
    const today = zonedParts(now, timezone);
    const [year, month] = today.date.split('-').map(Number);

    const startYear = month === 1 ? year - 1 : year;
    const startMonth = month === 1 ? 12 : month - 1;
    const pad = (n: number) => String(n).padStart(2, '0');

    return {
      start: instantAt(`${startYear}-${pad(startMonth)}-01`, 0, timezone),
      end: instantAt(`${year}-${pad(month)}-01`, 0, timezone),
      label: monthLabel(startYear, startMonth - 1),
    };
  }

  /** The first instant of the calendar year the given month belongs to. */
  private yearStart(timezone: string, monthStart: Date): Date {
    const year = zonedParts(monthStart, timezone).date.slice(0, 4);
    return instantAt(`${year}-01-01`, 0, timezone);
  }

  /** Money taken through MaybeOS between two instants. */
  private async moneyBetween(orgId: string, from: Date, to: Date) {
    const [dues, tickets, rooms] = await Promise.all([
      this.prisma.duesPayment.aggregate({
        where: { orgId, refundedAt: null, paidAt: { gte: from, lt: to } },
        _sum: { amountCents: true },
      }),
      this.prisma.ticket.aggregate({
        where: { event: { orgId }, refundedAt: null, createdAt: { gte: from, lt: to } },
        _sum: { amountCents: true },
      }),
      this.prisma.booking.aggregate({
        where: { room: { orgId }, refundedAt: null, paidAt: { gte: from, lt: to } },
        _sum: { amountCents: true },
      }),
    ]);

    return money({
      duesCents: dues._sum.amountCents ?? 0,
      ticketsCents: tickets._sum.amountCents ?? 0,
      roomsCents: rooms._sum.amountCents ?? 0,
    });
  }

  /**
   * Everything the recap states, read once and then frozen.
   *
   * Which definition of "member" matters here: `COUNTED_ROLES` excludes
   * guests, matching how Plus is billed and what the admin dashboard shows.
   * ImpactOS counts memberships without a role filter, so a co-op with guests
   * has two different member counts in the product — this one is the
   * defensible one, and the recap uses it everywhere.
   */
  async figuresFor(orgId: string, now: Date = new Date()): Promise<RecapFigures> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    const period = this.previousMonth(org.timezone, now);
    const yearFrom = this.yearStart(org.timezone, period.start);

    const [total, joined, hosted, attendance, rsvps, monthMoney, yearMoney, firstDues] =
      await Promise.all([
        this.prisma.userOrg.count({ where: { orgId, role: { in: [...COUNTED_ROLES] } } }),
        // The rows themselves, not a count: a bulk import has to be told
        // apart from a month of people joining, and only the arrival times
        // can do that.
        this.prisma.userOrg.findMany({
          where: {
            orgId,
            role: { in: [...COUNTED_ROLES] },
            memberSince: { gte: period.start, lt: period.end },
          },
          select: { createdAt: true },
        }),
        this.prisma.event.findMany({
          where: {
            orgId,
            isPublished: true,
            canceledAt: null,
            startTime: { gte: period.start, lt: period.end },
          },
          select: { id: true },
        }),
        this.prisma.attendance.groupBy({
          by: ['eventId'],
          where: {
            event: {
              orgId,
              isPublished: true,
              canceledAt: null,
              startTime: { gte: period.start, lt: period.end },
            },
          },
          _count: { _all: true },
        }),
        this.prisma.rsvp.findMany({
          where: {
            status: 'CONFIRMED',
            event: {
              orgId,
              isPublished: true,
              canceledAt: null,
              startTime: { gte: period.start, lt: period.end },
            },
          },
          select: { plusOnes: true },
        }),
        this.moneyBetween(orgId, period.start, period.end),
        this.moneyBetween(orgId, yearFrom, period.end),
        this.prisma.duesPayment.findFirst({
          where: { orgId },
          orderBy: { paidAt: 'asc' },
          select: { paidAt: true },
        }),
      ]);

    const contribution = await this.service
      .contribution(orgId, period.start, period.end)
      .catch(() => null);

    // Impact, all-time and already suppressed: `getSignals` returns a null
    // average for any category fewer than five people answered, and the recap
    // never re-aggregates answers itself. D-021 §10 — individual responses
    // are never exposed to anyone, organisers included.
    const signals = await this.impact.getSignals(orgId).catch(() => null);

    return {
      monthLabel: period.label,
      periodStart: period.start.toISOString(),
      periodEnd: period.end.toISOString(),
      members: { total, ...splitArrivals(joined.map((m) => m.createdAt)) },
      events: {
        hosted: hosted.length,
        checkedIn: attendance.reduce((n, row) => n + row._count._all, 0),
        eventsWithDoor: attendance.length,
        expected: rsvps.reduce((n, rsvp) => n + 1 + rsvp.plusOnes, 0),
      },
      money: {
        month: monthMoney,
        year: yearMoney,
        duesRecordedSince: firstDues?.paidAt.toISOString() ?? null,
      },
      service:
        contribution && contribution.totalHours > 0
          ? {
              hours: contribution.totalHours,
              members: contribution.members,
              valueCents: contribution.valueCents,
            }
          : null,
      impact: (signals?.categories ?? [])
        .filter((c) => c.average !== null)
        .map((c) => ({
          category: c.category,
          average: c.average as number,
          respondents: c.respondents,
        })),
    };
  }

  // ---------------------------------------------------------------------
  // Drafting, on the 1st
  // ---------------------------------------------------------------------

  /**
   * Draft every recap that is due (the `draft-monthly-recaps` task).
   *
   * Due means: the co-op has the recap on, is on a plan that includes it, and
   * its own calendar has reached the chosen hour of the 1st. The unique index
   * on `(orgId, periodStart)` is what stops a scheduler running every fifteen
   * minutes from drafting the same month four times.
   */
  async draftDue(now: Date = new Date()): Promise<RecapRunResult> {
    const orgs = await this.prisma.organization.findMany({
      where: { recapEnabled: true, plan: { in: ['PLUS', 'UNLIMITED'] } },
      select: { id: true, slug: true, timezone: true, recapDraftHour: true },
    });

    const result: RecapRunResult = { processed: 0, failed: 0, errors: [] };

    for (const org of orgs) {
      const local = zonedParts(now, org.timezone);
      if (!local.date.endsWith('-01')) continue;
      if (Math.floor(local.minutes / 60) !== org.recapDraftHour) continue;

      try {
        const drafted = await this.draftFor(org.id, now);
        if (drafted) result.processed += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${org.slug}: ${(error as Error).message}`);
      }
    }

    return result;
  }

  /**
   * Draft one co-op's recap and tell its organisers it is waiting.
   *
   * Returns null when the month is not worth a letter, or when the draft
   * already exists. A co-op that did nothing in a month gets no email about
   * having done nothing: six zeroes sent to the whole community is worse than
   * silence, and the recap exists to make membership feel worthwhile.
   */
  async draftFor(orgId: string, now: Date = new Date()) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, timezone: true, duesBackfilledAt: true },
    });
    if (!org) throw new NotFoundException('Community not found');

    const period = this.previousMonth(org.timezone, now);

    const existing = await this.prisma.monthlyRecap.findUnique({
      where: { orgId_periodStart: { orgId, periodStart: period.start } },
      select: { id: true },
    });
    if (existing) return null;

    // Dues before figures, once: MaybeOS recorded no dues payment before
    // RCP-01, so without this the first recap of every existing co-op would
    // report a year of dues as zero — and zero reads as a fact.
    if (!org.duesBackfilledAt) {
      try {
        const since = new Date(now.getTime() - BACKFILL_MONTHS * 31 * 24 * 60 * 60 * 1000);
        const read = await this.stripe.backfillDues(orgId, since);
        this.logger.log(
          `Backfilled dues for ${org.slug}: ${read.recorded} recorded of ${read.invoices} invoices, ${read.failed} failed`,
        );
      } catch (error) {
        // A Stripe outage must not cost the co-op its recap. The figures are
        // still true about everything MaybeOS recorded itself.
        this.logger.warn(`Dues backfill failed for ${org.slug}: ${(error as Error).message}`);
      }
    }

    const figures = await this.figuresFor(orgId, now);
    if (!worthSending(figures)) {
      this.logger.log(`${org.slug}: nothing happened in ${figures.monthLabel}; no recap drafted`);
      return null;
    }

    const recap = await this.prisma.monthlyRecap.create({
      data: {
        orgId,
        periodStart: period.start,
        periodEnd: period.end,
        figures: figures as unknown as Prisma.InputJsonValue,
      },
    });

    await this.composeFor(recap.id, orgId, figures);
    await this.tellOrganisers(org, figures.monthLabel);
    return recap;
  }

  /**
   * The paragraph at the top, where the co-op has composition configured.
   *
   * Never a blocker: a recap with no paragraph is figures and an organiser's
   * own note, which is most of what anybody reads anyway. A failure is
   * recorded on the row so the organiser can see why rather than wondering.
   */
  private async composeFor(
    recapId: string,
    orgId: string,
    figures: RecapFigures,
  ): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { recapShowMoney: true },
    });

    const result = await this.composer.composeRecap(
      recapFacts(figures, org?.recapShowMoney ?? true),
    );

    await this.prisma.monthlyRecap.update({
      where: { id: recapId },
      data:
        result.outcome === 'composed'
          ? { composed: result.paragraph, composeStatus: 'READY', composeNote: null }
          : { composeStatus: 'SKIPPED', composeNote: result.reason },
    });
  }

  /** The nudge: a draft nobody knows about is a draft nobody sends. */
  private async tellOrganisers(
    org: { id: string; name: string; slug: string },
    label: string,
  ): Promise<void> {
    const organisers = await this.prisma.userOrg.findMany({
      where: { orgId: org.id, role: { in: ['ADMIN', 'STAFF'] } },
      select: { user: { select: { email: true, name: true } } },
    });

    const url = `${this.appUrl()}/admin/${org.slug}/recap`;

    for (const organiser of organisers) {
      if (!organiser.user?.email) continue;
      await this.email.sendRecapReady(organiser.user.email, {
        organiserName: organiser.user.name ?? 'there',
        orgName: org.name,
        monthLabel: label,
        reviewUrl: url,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Reading and sending
  // ---------------------------------------------------------------------

  async latest(orgId: string) {
    const recap = await this.prisma.monthlyRecap.findFirst({
      where: { orgId },
      orderBy: { periodStart: 'desc' },
    });
    if (!recap) return null;

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { recapShowMoney: true },
    });

    return { ...recap, showMoney: org?.recapShowMoney ?? true };
  }

  async list(orgId: string) {
    return this.prisma.monthlyRecap.findMany({
      where: { orgId },
      orderBy: { periodStart: 'desc' },
      take: 24,
      select: {
        id: true,
        periodStart: true,
        status: true,
        sentAt: true,
        sentCount: true,
        note: true,
      },
    });
  }

  /** The organiser's own words. Editable until it is sent, and not after. */
  async setNote(orgId: string, recapId: string, note: string) {
    const recap = await this.prisma.monthlyRecap.findFirst({
      where: { id: recapId, orgId },
      select: { id: true, status: true },
    });
    if (!recap) throw new NotFoundException('That recap does not exist');
    if (recap.status === 'SENT') {
      throw new BadRequestException('That recap has already gone out, so it cannot be changed.');
    }

    return this.prisma.monthlyRecap.update({
      where: { id: recap.id },
      data: { note: note.trim() || null },
    });
  }

  /**
   * Send it.
   *
   * Marked sent before the emails go out, for the reason Radar marks a send
   * before handing it to Postmark: `EmailService` swallows failures, so the
   * only honest thing a marker can mean is that we tried. A recap that went
   * to half a co-op and is then sent again in full is worse than one that
   * reached most people once.
   */
  async send(orgId: string, recapId: string, userId: string): Promise<{ sent: number }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, plan: true, recapShowMoney: true },
    });
    if (!org) throw new NotFoundException('Community not found');
    assertPlanIncludes(org.plan, 'recap');

    const recap = await this.prisma.monthlyRecap.findFirst({
      where: { id: recapId, orgId },
    });
    if (!recap) throw new NotFoundException('That recap does not exist');
    if (recap.status === 'SENT') {
      throw new BadRequestException('That recap has already been sent.');
    }

    const figures = recap.figures as unknown as RecapFigures;

    const members = await this.prisma.userOrg.findMany({
      where: {
        orgId,
        recapEmails: true,
        // A member who has unsubscribed from the co-op's email has
        // unsubscribed from this too.
        // `emailOptIn` is three-valued: true opted in, false opted out, null
        // never asked. Written as `{ not: false }` this excluded the nulls —
        // in SQL `NULL <> false` is NULL, not true, so every member who had
        // never been asked was silently skipped, which on a real co-op is
        // almost everybody. The failure looked exactly like "nothing
        // matched": no error, no log line, an empty send.
        OR: [{ emailOptIn: null }, { emailOptIn: true }],
        role: { in: [...COUNTED_ROLES] },
      },
      select: { id: true, user: { select: { name: true, email: true } } },
      take: BATCH * 10,
    });

    const recipients = members.filter((m) => m.user?.email);

    await this.prisma.monthlyRecap.update({
      where: { id: recap.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        sentById: userId,
        sentCount: recipients.length,
      },
    });

    for (const member of recipients) {
      await this.email.sendRecap(member.user!.email, {
        memberName: member.user!.name ?? 'there',
        orgName: org.name,
        monthLabel: figures.monthLabel,
        note: recap.note,
        composed: recap.composed,
        showMoney: org.recapShowMoney,
        figures,
        unsubscribeUrl: this.unsubscribeUrl(member.id),
      });
    }

    return { sent: recipients.length };
  }

  /** One click, from the email, with no session. */
  async unsubscribeByToken(userOrgId: string): Promise<{ orgName: string } | null> {
    const membership = await this.prisma.userOrg.findUnique({
      where: { id: userOrgId },
      select: { id: true, org: { select: { name: true } } },
    });
    if (!membership) return null;

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { recapEmails: false },
    });

    return { orgName: membership.org.name };
  }

  /**
   * Whether this member currently gets the recap.
   *
   * A read, because the browser cannot know: a member who unsubscribed from
   * the footer of last month's email and then opens their profile would
   * otherwise be shown a ticked box over a false setting — the product
   * contradicting a choice they made, which is the fastest way to make an
   * unsubscribe link look like it did nothing.
   */
  async myEmails(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { recapEmails: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    return { recapEmails: membership.recapEmails };
  }

  async setRecapEmails(orgId: string, userId: string, on: boolean) {
    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this community');

    await this.prisma.userOrg.update({
      where: { id: membership.id },
      data: { recapEmails: on },
    });

    return { recapEmails: on };
  }

  private appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'https://maybeos.org';
  }

  private unsubscribeUrl(userOrgId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const token = encodeUnsubscribe({ userOrgId, purpose: 'recap' }, secret);
    return `${this.appUrl()}/radar/unsubscribe?token=${encodeURIComponent(token)}`;
  }
}
