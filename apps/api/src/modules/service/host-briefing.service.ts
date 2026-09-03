import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { dueAt, isDue, missedItsMoment, type BriefingRule } from './briefing-schedule';
import { zonedParts } from '../space/availability/zoned-time';
import { HostDutyDto, HostBriefingDto } from './dto/host-duty.dto';

export type Phase = 'BEFORE' | 'DURING' | 'AFTER';

/** The order phases read in, which is also the order they are written down. */
const PHASE_ORDER: Phase[] = ['BEFORE', 'DURING', 'AFTER'];

const PHASE_HEADING: Record<Phase, string> = {
  BEFORE: 'Before you open up',
  DURING: 'While you are in there',
  AFTER: 'Before you leave',
};

/**
 * What a host has to do around their booking, and telling them (SRV-03).
 *
 * The feature is **off until an admin writes a message**. There is no seeded
 * default and no implicit briefing: a co-op does not begin emailing its
 * members because MaybeOS shipped something, and the absence of a
 * `host_briefings` row is how that stays true.
 */
@Injectable()
export class HostBriefingService {
  private readonly logger = new Logger(HostBriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  // ── Admin: the duties ───────────────────────────────────────────────

  async listDuties(orgId: string) {
    return this.prisma.hostDuty.findMany({
      where: { orgId },
      include: { room: { select: { id: true, name: true } } },
      orderBy: [{ phase: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createDuty(orgId: string, dto: HostDutyDto) {
    // Scoped, not trusted: a roomId from the request that belongs to another
    // co-op would otherwise attach this co-op's instructions to their room.
    if (dto.roomId) await this.roomFor(orgId, dto.roomId);

    const last = await this.prisma.hostDuty.aggregate({
      where: { orgId, phase: dto.phase as never },
      _max: { sortOrder: true },
    });

    return this.prisma.hostDuty.create({
      data: {
        orgId,
        roomId: dto.roomId ?? null,
        phase: dto.phase as never,
        text: dto.text.trim(),
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async updateDuty(orgId: string, dutyId: string, dto: Partial<HostDutyDto> & { isActive?: boolean }) {
    await this.hostDutyFor(orgId, dutyId);
    if (dto.roomId) await this.roomFor(orgId, dto.roomId);

    return this.prisma.hostDuty.update({
      where: { id: dutyId },
      data: {
        ...(dto.text !== undefined && { text: dto.text.trim() }),
        ...(dto.phase !== undefined && { phase: dto.phase as never }),
        ...(dto.roomId !== undefined && { roomId: dto.roomId ?? null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async removeDuty(orgId: string, dutyId: string) {
    await this.hostDutyFor(orgId, dutyId);
    return this.prisma.hostDuty.delete({ where: { id: dutyId } });
  }

  private async hostDutyFor(orgId: string, dutyId: string) {
    const duty = await this.prisma.hostDuty.findFirst({ where: { id: dutyId, orgId } });
    if (!duty) throw new NotFoundException('Not found');
    return duty;
  }

  private async roomFor(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, orgId } });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  // ── Admin: the messages ─────────────────────────────────────────────

  async listBriefings(orgId: string) {
    return this.prisma.hostBriefing.findMany({
      where: { orgId },
      orderBy: { phase: 'asc' },
    });
  }

  /**
   * Write or rewrite the message for one phase.
   *
   * Upsert rather than create/update, because there is exactly one message per
   * phase and an admin editing it should not have to know whether one exists.
   */
  async saveBriefing(orgId: string, phase: Phase, dto: HostBriefingDto) {
    if (dto.anchor === 'CLOCK_ON_DAY' && dto.clockTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.clockTime)) {
      throw new BadRequestException('Send time must look like HH:MM');
    }

    const data = {
      subject: dto.subject.trim(),
      body: dto.body.trim(),
      anchor: (dto.anchor ?? 'CLOCK_ON_DAY') as never,
      clockTime: dto.clockTime ?? '07:00',
      offsetMinutes: dto.offsetMinutes ?? 60,
      ...(dto.isActive !== undefined && { isActive: dto.isActive }),
    };

    return this.prisma.hostBriefing.upsert({
      where: { orgId_phase: { orgId, phase: phase as never } },
      create: { orgId, phase: phase as never, ...data },
      update: data,
    });
  }

  async removeBriefing(orgId: string, phase: Phase) {
    // Deleting turns the phase off, which is what an admin means by removing
    // the message. Notices are kept — they are a record of what was sent.
    await this.prisma.hostBriefing.deleteMany({
      where: { orgId, phase: phase as never },
    });
    return { removed: true };
  }

  // ── Composing ───────────────────────────────────────────────────────

  /**
   * The duties that apply to a booking of this room, in this phase.
   *
   * Org-wide duties (`roomId: null`) come first, then the room's own — the
   * general rule before its exception, which is how somebody reads a list.
   */
  private applicable(
    duties: { roomId: string | null; phase: string; sortOrder: number; text: string }[],
    roomId: string,
    phase: Phase,
  ) {
    return duties
      .filter((d) => d.phase === phase && (d.roomId === null || d.roomId === roomId))
      .sort((a, b) => {
        if ((a.roomId === null) !== (b.roomId === null)) return a.roomId === null ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      });
  }

  /**
   * One email covering every phase due in this run.
   *
   * Charley's defaults put Before and During at the same moment, so they
   * arrive together rather than as two emails a minute apart. The subject is
   * the earliest due phase's — an admin who wants them separate moves one of
   * the send times, and they separate on their own.
   */
  buildEmail(input: {
    orgName: string;
    roomName: string;
    when: string;
    hostName?: string | null;
    phases: {
      phase: Phase;
      subject: string;
      body: string;
      duties: { text: string }[];
    }[];
  }): { subject: string; html: string } {
    const ordered = [...input.phases].sort(
      (a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase),
    );

    const sections = ordered
      .map((p) => {
        const list = p.duties.length
          ? `<ul>${p.duties.map((d) => `<li>${escapeHtml(d.text)}</li>`).join('')}</ul>`
          : '';
        // The heading is only worth printing when there is more than one
        // section; a lone "Before you open up" above the only paragraph in
        // the email is furniture.
        const heading =
          ordered.length > 1 ? `<h3>${escapeHtml(PHASE_HEADING[p.phase])}</h3>` : '';
        return `${heading}<p>${escapeHtml(p.body).replace(/\n/g, '<br>')}</p>${list}`;
      })
      .join('');

    return {
      subject: ordered[0].subject,
      html:
        `<p>${input.hostName ? `Hi ${escapeHtml(input.hostName.split(' ')[0])},` : 'Hi,'}</p>` +
        `<p>You have <strong>${escapeHtml(input.roomName)}</strong> at ${escapeHtml(input.when)}.</p>` +
        sections +
        `<p style="color:#666;font-size:12px">Sent by ${escapeHtml(input.orgName)} through MaybeOS.</p>`,
    };
  }

  // ── The scheduled run ───────────────────────────────────────────────

  /**
   * Send every briefing that has come due, once.
   *
   * Shaped like the rest of the scheduler (D-022): no jobs table, ask the
   * database what is overdue, and let the `host_briefing_notices` unique key
   * make a retried invocation a no-op rather than four emails.
   */
  async sendDue(now: Date = new Date()): Promise<{ sent: number; failed: number; errors: string[] }> {
    const briefings = await this.prisma.hostBriefing.findMany({ where: { isActive: true } });
    if (briefings.length === 0) return { sent: 0, failed: 0, errors: [] };

    const orgIds = [...new Set(briefings.map((b) => b.orgId))];

    // A generous window either side of now: a booking whose briefing is due
    // in this run must be in it, and nothing older than the grace period can
    // still qualify. Bounded so switching the feature on cannot sweep years.
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: 'APPROVED',
        canceledAt: null,
        room: { orgId: { in: orgIds } },
        startTime: { gte: new Date(now.getTime() - 3 * 86_400_000) },
        endTime: { lte: new Date(now.getTime() + 3 * 86_400_000) },
      },
      include: {
        user: { select: { email: true, name: true } },
        room: { select: { id: true, name: true, orgId: true } },
        briefings: { select: { phase: true } },
      },
    });
    if (bookings.length === 0) return { sent: 0, failed: 0, errors: [] };

    const [orgs, duties] = await Promise.all([
      this.prisma.organization.findMany({
        where: { id: { in: orgIds } },
        select: { id: true, name: true, timezone: true },
      }),
      this.prisma.hostDuty.findMany({ where: { orgId: { in: orgIds }, isActive: true } }),
    ]);
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const booking of bookings) {
      const org = orgById.get(booking.room.orgId);
      if (!org || !booking.user.email) continue;

      const already = new Set(booking.briefings.map((n) => n.phase as Phase));

      const due = briefings
        .filter((b) => b.orgId === org.id && !already.has(b.phase as Phase))
        .map((b) => ({
          briefing: b,
          due: dueAt(b as unknown as BriefingRule, booking, org.timezone),
        }))
        .filter(({ due }) => isDue(due, now) && !missedItsMoment(due, booking.createdAt));

      if (due.length === 0) continue;

      const { subject, html } = this.buildEmail({
        orgName: org.name,
        roomName: booking.room.name,
        when: this.whenLabel(booking.startTime, booking.endTime, org.timezone),
        hostName: booking.user.name,
        phases: due.map(({ briefing }) => ({
          phase: briefing.phase as Phase,
          subject: briefing.subject,
          body: briefing.body,
          duties: this.applicable(duties, booking.room.id, briefing.phase as Phase),
        })),
      });

      const phases = due.map(({ briefing }) => briefing.phase as Phase);

      try {
        // The notice is written **first**, so a crash between sending and
        // recording cannot mail the same host again every fifteen minutes.
        await this.prisma.hostBriefingNotice.createMany({
          data: phases.map((phase) => ({ bookingId: booking.id, phase: phase as never })),
          skipDuplicates: true,
        });

        const delivered = await this.email.sendRaw(booking.user.email, subject, html);

        if (!delivered) {
          // Written first, so take it back: otherwise a Postmark outage is a
          // briefing nobody receives and nothing retries. The retry is bounded
          // by the grace window rather than by a counter — a genuinely
          // undeliverable address is attempted for two hours and then stops
          // on its own, because the briefing is no longer due.
          await this.prisma.hostBriefingNotice.deleteMany({
            where: { bookingId: booking.id, phase: { in: phases as never[] } },
          });
          failed += 1;
          errors.push(`booking ${booking.id}: the email provider rejected it`);
          continue;
        }

        sent += 1;
      } catch (error) {
        failed += 1;
        const message = (error as Error).message;
        errors.push(`booking ${booking.id}: ${message}`);
        this.logger.error(`Host briefing failed for booking ${booking.id}`, error as Error);
      }
    }

    return { sent, failed, errors };
  }

  /** "Wed, Sep 2 · 6:00 PM – 9:00 PM" in the co-op's timezone. */
  private whenLabel(start: Date, end: Date, timeZone: string): string {
    const day = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone,
    }).format(start);
    const time = (d: Date) =>
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(d);

    return `${day} · ${time(start)} – ${time(end)}`;
  }

  /**
   * What a host would be sent for a booking, without sending it.
   *
   * The admin screen's preview. An admin writing instructions their members
   * will act on should be able to read the thing that arrives, and the only
   * honest preview is the one built by the code that sends it.
   */
  async preview(orgId: string, phase: Phase) {
    const [org, briefing, duties] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: { name: true, timezone: true },
      }),
      this.prisma.hostBriefing.findFirst({ where: { orgId, phase: phase as never } }),
      this.prisma.hostDuty.findMany({ where: { orgId, phase: phase as never, isActive: true } }),
    ]);
    if (!org) throw new NotFoundException('Co-op not found');
    if (!briefing) throw new NotFoundException('No message written for that phase yet');

    const start = new Date();
    start.setHours(start.getHours() + 24, 0, 0, 0);
    const end = new Date(start.getTime() + 3 * 3_600_000);

    const { subject, html } = this.buildEmail({
      orgName: org.name,
      roomName: 'The Attic',
      when: this.whenLabel(start, end, org.timezone),
      hostName: 'Sam',
      phases: [
        {
          phase,
          subject: briefing.subject,
          body: briefing.body,
          duties: duties.sort((a, b) => a.sortOrder - b.sortOrder),
        },
      ],
    });

    return {
      subject,
      html,
      sendsAt: this.describeSchedule(briefing as unknown as BriefingRule, org.timezone),
    };
  }

  /** The schedule in words, so an admin can check it without doing the maths. */
  describeSchedule(rule: BriefingRule, timeZone: string): string {
    switch (rule.anchor) {
      case 'CLOCK_ON_DAY':
        return `At ${rule.clockTime} on the day of the booking (${timeZone.split('/').pop()?.replace('_', ' ')} time).`;
      case 'BEFORE_START':
        return `${minutesInWords(rule.offsetMinutes)} before the booking starts.`;
      case 'AFTER_START':
        return `${minutesInWords(rule.offsetMinutes)} after the booking starts.`;
      case 'BEFORE_END':
        return `${minutesInWords(rule.offsetMinutes)} before the booking ends.`;
      case 'AFTER_END':
        return `${minutesInWords(rule.offsetMinutes)} after the booking ends.`;
    }
  }
}

function minutesInWords(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  return `${Math.floor(hours)}h ${minutes % 60}m`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
