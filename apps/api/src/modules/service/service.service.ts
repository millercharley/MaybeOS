import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { occurrencesBetween, nextOccurrences, DutyRule } from './occurrences';
import { standingFor, currentWindow, ServicePeriod } from './expectation';
import { zonedParts } from '../space/availability/zoned-time';
import { CreateDutyDto, UpdateDutyDto } from './dto/duty.dto';
import { ClaimDutyDto, CompleteClaimDto } from './dto/claim.dto';

/** How far ahead an adoption keeps claims materialised. */
const ADOPTION_HORIZON_DAYS = 120;

/** How many occurrences a duty shows on the open list by default. */
const DEFAULT_LOOKAHEAD_DAYS = 60;

/**
 * The service rota (SRV-01).
 *
 * An organiser names the things that need doing; members take turns; the hours
 * add up. The design decision the rest of this file follows from: **a duty is
 * a rule and its occurrences are computed**, so `duty_claims` holds only turns
 * somebody actually took. Nothing here materialises a calendar.
 *
 * The one exception is adoption — "I'll take all of these" — which writes
 * claims ahead of itself, because a standing arrangement that appears nowhere
 * is how a co-op finds out in March that nobody has done it since December.
 */
@Injectable()
export class ServiceService {
  private readonly logger = new Logger(ServiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Reading the co-op ───────────────────────────────────────────────

  private async orgTimezone(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    if (!org) throw new NotFoundException('Co-op not found');
    return org.timezone;
  }

  /** A duty in this co-op, or a 404. Scoped by orgId, never by bare id (SEC-04). */
  private async dutyFor(orgId: string, dutyId: string) {
    const duty = await this.prisma.duty.findFirst({ where: { id: dutyId, orgId } });
    if (!duty) throw new NotFoundException('Duty not found');
    return duty;
  }

  private ruleOf(duty: {
    recurrence: string;
    startsOn: Date;
    endsOn: Date | null;
    startTime: string;
  }): DutyRule {
    return {
      recurrence: duty.recurrence as DutyRule['recurrence'],
      startsOn: duty.startsOn,
      endsOn: duty.endsOn,
      startTime: duty.startTime,
    };
  }

  private today(timeZone: string, now = new Date()): string {
    return zonedParts(now, timeZone).date;
  }

  private shiftDate(date: string, days: number): string {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  // ── Duties, as an organiser sees them ───────────────────────────────

  async createDuty(orgId: string, dto: CreateDutyDto) {
    const timeZone = await this.orgTimezone(orgId);
    this.assertDates(dto.startsOn, dto.endsOn);

    return this.prisma.duty.create({
      data: {
        orgId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        estimatedMinutes: dto.estimatedMinutes,
        capacity: dto.capacity ?? 1,
        requiresApproval: dto.requiresApproval ?? false,
        recurrence: (dto.recurrence ?? 'NONE') as never,
        startsOn: this.localMidnight(dto.startsOn, timeZone),
        endsOn: dto.endsOn ? this.localMidnight(dto.endsOn, timeZone) : null,
        startTime: dto.startTime ?? '09:00',
      },
    });
  }

  async updateDuty(orgId: string, dutyId: string, dto: UpdateDutyDto) {
    await this.dutyFor(orgId, dutyId);
    const timeZone = await this.orgTimezone(orgId);
    this.assertDates(dto.startsOn, dto.endsOn);

    return this.prisma.duty.update({
      where: { id: dutyId },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.description !== undefined && {
          description: dto.description?.trim() || null,
        }),
        ...(dto.estimatedMinutes !== undefined && {
          estimatedMinutes: dto.estimatedMinutes,
        }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.requiresApproval !== undefined && {
          requiresApproval: dto.requiresApproval,
        }),
        ...(dto.recurrence !== undefined && { recurrence: dto.recurrence as never }),
        ...(dto.startsOn !== undefined && {
          startsOn: this.localMidnight(dto.startsOn, timeZone),
        }),
        ...(dto.endsOn !== undefined && {
          endsOn: dto.endsOn ? this.localMidnight(dto.endsOn, timeZone) : null,
        }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /**
   * Retired, not deleted, when anybody has ever served it.
   *
   * Deleting cascades to the claims, which is the hours members have already
   * done. A rota that can erase somebody's record by tidying up is not one
   * anybody should trust with a tier requirement.
   */
  async removeDuty(orgId: string, dutyId: string) {
    await this.dutyFor(orgId, dutyId);

    const served = await this.prisma.dutyClaim.count({ where: { dutyId } });
    if (served > 0) {
      return this.prisma.duty.update({
        where: { id: dutyId },
        data: { isActive: false },
      });
    }

    return this.prisma.duty.delete({ where: { id: dutyId } });
  }

  private assertDates(startsOn?: string, endsOn?: string | null) {
    if (startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) {
      throw new BadRequestException('startsOn must look like YYYY-MM-DD');
    }
    if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) {
      throw new BadRequestException('endsOn must look like YYYY-MM-DD');
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      throw new BadRequestException('A duty cannot end before it starts.');
    }
  }

  private localMidnight(date: string, timeZone: string): Date {
    // Noon rather than midnight, so a date can never land on the wrong side of
    // a daylight saving boundary when read back. Only the date is ever used.
    const [y, m, d] = date.split('-').map(Number);
    const naive = Date.UTC(y, m - 1, d, 12);
    const guess = new Date(naive);
    const offset =
      new Date(guess.toLocaleString('en-US', { timeZone })).getTime() - guess.getTime();
    return new Date(naive - offset);
  }

  // ── The open list ───────────────────────────────────────────────────

  /**
   * Every occurrence in a window, with who is on it and how many are still
   * needed.
   *
   * This is the shape both Serve and Serving read: a member sees what they can
   * take, an organiser sees the gaps. One query for the duties and one for the
   * claims across all of them — not one per duty, which is how a rota with
   * thirty duties becomes sixty round trips.
   */
  async openings(
    orgId: string,
    opts: { from?: string; to?: string; includeInactive?: boolean } = {},
  ) {
    const timeZone = await this.orgTimezone(orgId);
    const from = opts.from ?? this.today(timeZone);
    const to = opts.to ?? this.shiftDate(from, DEFAULT_LOOKAHEAD_DAYS);

    const duties = await this.prisma.duty.findMany({
      where: { orgId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: { title: 'asc' },
    });
    if (duties.length === 0) return { from, to, timezone: timeZone, occurrences: [] };

    const claims = await this.prisma.dutyClaim.findMany({
      where: {
        dutyId: { in: duties.map((d) => d.id) },
        status: { in: ['CLAIMED', 'CONFIRMED', 'DONE'] },
        occursAt: {
          gte: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000),
          lte: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000),
        },
      },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    const byOccurrence = new Map<string, typeof claims>();
    for (const claim of claims) {
      const key = `${claim.dutyId}:${claim.occursAt.toISOString()}`;
      const list = byOccurrence.get(key) ?? [];
      list.push(claim);
      byOccurrence.set(key, list);
    }

    const occurrences = duties.flatMap((duty) =>
      occurrencesBetween(this.ruleOf(duty), from, to, timeZone).map((occurrence) => {
        const taken =
          byOccurrence.get(`${duty.id}:${occurrence.occursAt.toISOString()}`) ?? [];

        return {
          dutyId: duty.id,
          title: duty.title,
          description: duty.description,
          estimatedMinutes: duty.estimatedMinutes,
          capacity: duty.capacity,
          requiresApproval: duty.requiresApproval,
          recurrence: duty.recurrence,
          date: occurrence.date,
          occursAt: occurrence.occursAt,
          remaining: Math.max(0, duty.capacity - taken.length),
          claims: taken.map((claim) => ({
            id: claim.id,
            userId: claim.userId,
            name: claim.user.name,
            avatarUrl: claim.user.avatarUrl,
            status: claim.status,
          })),
        };
      }),
    );

    occurrences.sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime());
    return { from, to, timezone: timeZone, occurrences };
  }

  // ── Taking a turn ───────────────────────────────────────────────────

  /**
   * Claim one or more occurrences of a duty.
   *
   * The dates are validated against the rule rather than trusted: a client
   * that sends a Wednesday for a Tuesday duty would otherwise create a turn
   * that exists nowhere on the calendar and can never be seen again.
   */
  async claim(orgId: string, userId: string, dutyId: string, dto: ClaimDutyDto) {
    const duty = await this.dutyFor(orgId, dutyId);
    if (!duty.isActive) throw new BadRequestException('That duty is no longer running.');

    const timeZone = await this.orgTimezone(orgId);
    const today = this.today(timeZone);

    const wanted = [...new Set(dto.dates)].sort();
    if (wanted.length === 0) throw new BadRequestException('Pick at least one date.');

    const valid = new Map(
      occurrencesBetween(
        this.ruleOf(duty),
        wanted[0],
        wanted[wanted.length - 1],
        timeZone,
      ).map((o) => [o.date, o.occursAt]),
    );

    const created: string[] = [];
    for (const date of wanted) {
      const occursAt = valid.get(date);
      if (!occursAt) {
        throw new BadRequestException(`${duty.title} does not happen on ${date}.`);
      }
      if (date < today) {
        throw new BadRequestException('That date has already passed.');
      }

      await this.take(duty, userId, occursAt, null);
      created.push(date);
    }

    return { dutyId, claimed: created };
  }

  /**
   * One turn, or a refusal. Shared by claiming and by adoption top-up.
   *
   * Capacity is checked and written in a transaction: two members clicking the
   * last slot on one occurrence at the same moment would both read "one left"
   * otherwise, and both get it.
   */
  private async take(
    duty: { id: string; capacity: number; requiresApproval: boolean; title: string },
    userId: string,
    occursAt: Date,
    adoptionId: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const mine = await tx.dutyClaim.findFirst({
        where: { dutyId: duty.id, userId, occursAt },
      });
      if (mine && mine.status !== 'RELEASED') {
        throw new ConflictException(`You are already down for ${duty.title} that day.`);
      }

      const taken = await tx.dutyClaim.count({
        where: {
          dutyId: duty.id,
          occursAt,
          status: { in: ['CLAIMED', 'CONFIRMED', 'DONE'] },
        },
      });
      if (taken >= duty.capacity) {
        throw new ConflictException(`${duty.title} is already covered that day.`);
      }

      const status = duty.requiresApproval ? 'CLAIMED' : 'CONFIRMED';

      // A released claim is reused rather than a second row written: the
      // unique key is (duty, member, occurrence), and somebody who gives a
      // turn back and then takes it again is the same turn.
      if (mine) {
        return tx.dutyClaim.update({
          where: { id: mine.id },
          data: { status, releasedAt: null, adoptionId },
        });
      }

      return tx.dutyClaim.create({
        data: { dutyId: duty.id, userId, occursAt, status, adoptionId },
      });
    });
  }

  /**
   * "I'll take all of these."
   *
   * Standing: it owns the occurrences that exist and the ones nobody has
   * computed yet, until it is handed back. Claims are materialised ahead so
   * the duty still shows a name against it on the calendar.
   */
  async adopt(orgId: string, userId: string, dutyId: string) {
    const duty = await this.dutyFor(orgId, dutyId);
    if (!duty.isActive) throw new BadRequestException('That duty is no longer running.');
    if (duty.recurrence === 'NONE') {
      throw new BadRequestException(
        'That is a one-off. Claim the date rather than taking it on standing.',
      );
    }

    const standing = await this.prisma.dutyAdoption.findFirst({
      where: { dutyId, userId, releasedAt: null },
    });
    if (standing) throw new ConflictException('You already have this one on standing.');

    const adoption = await this.prisma.dutyAdoption.create({
      data: { dutyId, userId },
    });

    const filled = await this.topUp(adoption.id, orgId);
    return { adoption, claimed: filled };
  }

  /**
   * Materialise an adoption's claims out to the horizon.
   *
   * Idempotent, so the scheduler can run it as often as it likes: a turn
   * somebody already has is skipped, and one that is full or claimed by
   * somebody else is left alone rather than fought over.
   */
  async topUp(adoptionId: string, orgId: string): Promise<number> {
    const adoption = await this.prisma.dutyAdoption.findFirst({
      where: { id: adoptionId, releasedAt: null, duty: { orgId } },
      include: { duty: true },
    });
    if (!adoption) return 0;

    const timeZone = await this.orgTimezone(orgId);
    const from = this.today(timeZone);
    const to = this.shiftDate(from, ADOPTION_HORIZON_DAYS);

    let filled = 0;
    for (const occurrence of occurrencesBetween(
      this.ruleOf(adoption.duty),
      from,
      to,
      timeZone,
    )) {
      try {
        await this.take(adoption.duty, adoption.userId, occurrence.occursAt, adoption.id);
        filled += 1;
      } catch {
        // Already theirs, or somebody else took that one. Both are fine: an
        // adoption is a standing offer, not a claim on every future Tuesday
        // regardless of who else turned up.
      }
    }
    return filled;
  }

  /** Hand a standing duty back. Turns already done stay done. */
  async releaseAdoption(orgId: string, userId: string, adoptionId: string) {
    const adoption = await this.prisma.dutyAdoption.findFirst({
      where: { id: adoptionId, duty: { orgId } },
    });
    if (!adoption) throw new NotFoundException('Not found');
    if (adoption.userId !== userId) {
      throw new ForbiddenException('That is not yours to hand back.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dutyAdoption.update({
        where: { id: adoptionId },
        data: { releasedAt: now },
      });
      // Only the turns still ahead, and only the ones this adoption made.
      // A turn already done is a fact about the past.
      await tx.dutyClaim.updateMany({
        where: {
          adoptionId,
          occursAt: { gt: now },
          status: { in: ['CLAIMED', 'CONFIRMED'] },
        },
        data: { status: 'RELEASED', releasedAt: now },
      });
    });

    return { released: true };
  }

  /** Give one turn back. */
  async release(orgId: string, userId: string, claimId: string) {
    const claim = await this.claimFor(orgId, claimId);
    if (claim.userId !== userId) {
      throw new ForbiddenException('That is not yours to hand back.');
    }
    if (claim.status === 'DONE') {
      throw new BadRequestException('That one is already done.');
    }

    return this.prisma.dutyClaim.update({
      where: { id: claimId },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  }

  private async claimFor(orgId: string, claimId: string) {
    const claim = await this.prisma.dutyClaim.findFirst({
      where: { id: claimId, duty: { orgId } },
      include: { duty: true },
    });
    if (!claim) throw new NotFoundException('Not found');
    return claim;
  }

  /**
   * Mark a turn done, and credit the minutes.
   *
   * The estimate is the default and the member can correct it — Charley's
   * answer to how hours land: nobody types a number for the ordinary case, and
   * the case where it ran long is not silently lost.
   */
  async complete(
    orgId: string,
    userId: string,
    claimId: string,
    dto: CompleteClaimDto,
  ) {
    const claim = await this.claimFor(orgId, claimId);
    if (claim.userId !== userId) {
      throw new ForbiddenException('That is not your turn to mark done.');
    }
    if (claim.status === 'RELEASED') {
      throw new BadRequestException('You handed that one back.');
    }
    if (claim.status === 'CLAIMED') {
      throw new BadRequestException('An organiser has not confirmed that one yet.');
    }

    const edited = dto.minutes !== undefined && dto.minutes !== claim.duty.estimatedMinutes;

    return this.prisma.dutyClaim.update({
      where: { id: claimId },
      data: {
        status: 'DONE',
        completedAt: new Date(),
        minutes: dto.minutes ?? claim.duty.estimatedMinutes,
        minutesEdited: edited,
        minutesNote: edited ? dto.note?.trim() || null : null,
      },
    });
  }

  // ── An organiser confirming a gated duty ────────────────────────────

  async confirmClaim(orgId: string, reviewerId: string, claimId: string) {
    const claim = await this.claimFor(orgId, claimId);
    if (claim.status !== 'CLAIMED') {
      throw new BadRequestException('That claim is not waiting on anybody.');
    }

    return this.prisma.dutyClaim.update({
      where: { id: claimId },
      data: { status: 'CONFIRMED', reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  async rejectClaim(orgId: string, reviewerId: string, claimId: string) {
    const claim = await this.claimFor(orgId, claimId);
    if (claim.status !== 'CLAIMED') {
      throw new BadRequestException('That claim is not waiting on anybody.');
    }

    return this.prisma.dutyClaim.update({
      where: { id: claimId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  // ── A member's own record ───────────────────────────────────────────

  async myService(orgId: string, userId: string) {
    const timeZone = await this.orgTimezone(orgId);
    const now = new Date();

    const [claims, adoptions, membership] = await Promise.all([
      this.prisma.dutyClaim.findMany({
        where: { userId, duty: { orgId }, status: { not: 'RELEASED' } },
        include: { duty: { select: { id: true, title: true, estimatedMinutes: true } } },
        orderBy: { occursAt: 'desc' },
        take: 200,
      }),
      this.prisma.dutyAdoption.findMany({
        where: { userId, releasedAt: null, duty: { orgId } },
        include: { duty: { select: { id: true, title: true, recurrence: true } } },
      }),
      this.prisma.userOrg.findFirst({
        where: { userId, orgId },
        include: {
          tier: { select: { name: true, serviceMinutes: true, servicePeriod: true } },
        },
      }),
    ]);

    const done = claims.filter((c) => c.status === 'DONE');
    const totalMinutes = done.reduce((sum, c) => sum + (c.minutes ?? 0), 0);

    const period = membership?.tier?.servicePeriod as ServicePeriod | null;
    const standing = period
      ? standingFor({
          period,
          tierMinutes: membership?.tier?.serviceMinutes,
          servedMinutes: this.minutesIn(done, currentWindow(period, now, timeZone), timeZone),
          memberSince: membership?.memberSince ?? now,
          timeZone,
          now,
        })
      : null;

    return {
      timezone: timeZone,
      totalMinutes,
      standing,
      upcoming: claims
        .filter((c) => c.occursAt >= now && c.status !== 'DONE')
        .sort((a, b) => a.occursAt.getTime() - b.occursAt.getTime()),
      past: claims.filter((c) => c.occursAt < now || c.status === 'DONE'),
      adoptions,
    };
  }

  /** Minutes served inside a window, counted on the day the turn happened. */
  private minutesIn(
    claims: { occursAt: Date; minutes: number | null }[],
    window: { from: string; to: string },
    timeZone: string,
  ): number {
    return claims.reduce((sum, claim) => {
      const date = zonedParts(claim.occursAt, timeZone).date;
      const inside = date >= window.from && date <= window.to;
      return inside ? sum + (claim.minutes ?? 0) : sum;
    }, 0);
  }

  // ── What an organiser needs to see ──────────────────────────────────

  /**
   * Where the co-op stands: hours by member, and who is short.
   *
   * Members with no expectation are still listed with their hours — service is
   * worth seeing whether or not a tier demands it.
   */
  async coopStanding(orgId: string) {
    const timeZone = await this.orgTimezone(orgId);
    const now = new Date();

    const members = await this.prisma.userOrg.findMany({
      where: { orgId },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
        tier: { select: { name: true, serviceMinutes: true, servicePeriod: true } },
      },
    });

    const claims = await this.prisma.dutyClaim.findMany({
      where: { duty: { orgId }, status: 'DONE' },
      select: { userId: true, minutes: true, occursAt: true },
    });

    const byUser = new Map<string, typeof claims>();
    for (const claim of claims) {
      const list = byUser.get(claim.userId) ?? [];
      list.push(claim);
      byUser.set(claim.userId, list);
    }

    const rows = members.map((membership) => {
      const mine = byUser.get(membership.userId) ?? [];
      const period = membership.tier?.servicePeriod as ServicePeriod | null;

      return {
        userId: membership.userId,
        name: membership.user.name,
        avatarUrl: membership.user.avatarUrl,
        tier: membership.tier?.name ?? null,
        totalMinutes: mine.reduce((sum, c) => sum + (c.minutes ?? 0), 0),
        standing: period
          ? standingFor({
              period,
              tierMinutes: membership.tier?.serviceMinutes,
              servedMinutes: this.minutesIn(
                mine,
                currentWindow(period, now, timeZone),
                timeZone,
              ),
              memberSince: membership.memberSince,
              timeZone,
              now,
            })
          : null,
      };
    });

    rows.sort((a, b) => b.totalMinutes - a.totalMinutes);
    return { timezone: timeZone, members: rows };
  }

  /** Claims waiting on an organiser, for a gated duty. */
  async pendingClaims(orgId: string) {
    return this.prisma.dutyClaim.findMany({
      where: { duty: { orgId }, status: 'CLAIMED' },
      include: {
        duty: { select: { id: true, title: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { occursAt: 'asc' },
    });
  }

  /** Standing arrangements, and how long they have stood. */
  async standingDuties(orgId: string) {
    return this.prisma.dutyAdoption.findMany({
      where: { releasedAt: null, duty: { orgId } },
      include: {
        duty: { select: { id: true, title: true, recurrence: true } },
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { startedAt: 'asc' },
    });
  }

  /** The next few turns of one duty, for the organiser's coverage view. */
  async upcomingFor(orgId: string, dutyId: string, count = 8) {
    const duty = await this.dutyFor(orgId, dutyId);
    const timeZone = await this.orgTimezone(orgId);

    return nextOccurrences(
      this.ruleOf(duty),
      this.today(timeZone),
      count,
      timeZone,
    );
  }
}
