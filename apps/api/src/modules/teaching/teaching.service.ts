import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { EventsService } from '../events/events.service';
import { CreateEventDto } from '../events/dto/create-event.dto';
import {
  CreateOfferingDto,
  OfferingInterestDto,
  UpdateOfferingDto,
} from './dto/offering.dto';
import {
  LESSONS_HAVE_NO_SESSIONS,
  LESSONS_NOT_YET_PAYABLE,
  NOT_YOUR_INTEREST_LIST,
  NOT_YOUR_OFFERING,
  UNTITLED_SLUG,
  canChargeThroughMaybeOS,
  canEditOffering,
  canSeeInterest,
  mayHaveSessions,
  offeringSlug,
  visibleTo,
} from './offering-control';
import { MEMBER_OFFERING_SELECT, PUBLIC_OFFERING_SELECT } from './offering-view';

/** Who is asking, and whether they run the co-op. Never a role (EVT-50). */
export interface Actor {
  userId: string;
  isStaff: boolean;
}

/**
 * What members teach, and what they are willing to teach (TCH-01).
 *
 * The companion to `EventsService` rather than a replacement for it: an
 * offering is the broadcast, and a workshop's dates are events pointing back
 * at it. Everything about a *session* — tickets, capacity, RSVPs, the
 * calendar, the ICS feed, payouts — belongs to the events module and is
 * reached through it, not reimplemented here.
 */
@Injectable()
export class TeachingService {
  private readonly logger = new Logger(TeachingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  /* ─── Guards the routes cannot express ─────────────────────── */

  /**
   * Whether this co-op does teaching at all.
   *
   * Checked in the service, like `memberChannelsEnabled` in
   * `commons.service.ts`. There is no feature-guard decorator in this repo and
   * a password-reset feature is not the place to invent one — nor is this.
   */
  private async requireEnabled(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { teachingEnabled: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.teachingEnabled) {
      throw new ForbiddenException('This co-op is not using teaching offerings.');
    }
  }

  /**
   * One offering, re-scoped to the co-op (SEC-04).
   *
   * The guard proved the caller belongs to `orgId`; it proved nothing about
   * this id. Pairing your own org with another co-op's row was once enough to
   * edit it, so every read goes through here, and a miss is `NotFound` rather
   * than `Forbidden` — the row's existence in another co-op is not this
   * caller's business.
   */
  private async findInOrg(orgId: string, id: string) {
    const offering = await this.prisma.offering.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        orgId: true,
        kind: true,
        title: true,
        slug: true,
        teacherId: true,
        createdById: true,
        visibility: true,
        isPublished: true,
        payment: true,
        closedAt: true,
      },
    });
    if (!offering) throw new NotFoundException('Offering not found');
    return offering;
  }

  private async loadForActor(orgId: string, id: string, actor: Actor) {
    const offering = await this.findInOrg(orgId, id);
    if (!canEditOffering(offering, actor.userId, actor.isStaff)) {
      throw new ForbiddenException(NOT_YOUR_OFFERING);
    }
    return offering;
  }

  /** `title` as a slug, made unique against the compound index. */
  private async uniqueSlug(orgId: string, title: string, exceptId?: string) {
    const base = offeringSlug(title) || UNTITLED_SLUG;
    const clash = await this.prisma.offering.findUnique({
      where: { orgId_slug: { orgId, slug: base } },
      select: { id: true },
    });
    if (!clash || clash.id === exceptId) return base;

    return `${base}-${Date.now()}`;
  }

  /**
   * Whether this teacher may be named by this caller.
   *
   * A member writes up their own; an organiser may write one for somebody
   * else, which is the case the field exists for. Both have to actually be in
   * the co-op — an offering taught by a stranger is an advert for somebody
   * who cannot be reached.
   */
  private async resolveTeacher(
    orgId: string,
    actor: Actor,
    teacherId: string | undefined,
  ): Promise<string> {
    if (!teacherId || teacherId === actor.userId) return actor.userId;

    if (!actor.isStaff) {
      throw new ForbiddenException(
        'Only an organiser can write up an offering for somebody else.',
      );
    }

    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId: teacherId },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException('That person is not a member of this co-op.');
    }

    return teacherId;
  }

  /** Money rules that are the same on create and update. */
  private assertPaymentMakesSense(
    kind: 'WORKSHOP' | 'PRIVATE_LESSON',
    payment: string | undefined,
  ) {
    if (payment === 'THROUGH_MAYBEOS' && !canChargeThroughMaybeOS(kind)) {
      throw new BadRequestException(LESSONS_NOT_YET_PAYABLE);
    }
  }

  /* ─── Writing ──────────────────────────────────────────────── */

  async create(orgId: string, dto: CreateOfferingDto, actor: Actor) {
    await this.requireEnabled(orgId);
    this.assertPaymentMakesSense(dto.kind, dto.payment);

    const teacherId = await this.resolveTeacher(orgId, actor, dto.teacherId);
    const slug = await this.uniqueSlug(orgId, dto.title);

    return this.prisma.offering.create({
      data: {
        orgId,
        teacherId,
        // Who wrote it, kept apart from who teaches it (EVT-32). An organiser
        // writing for a member would otherwise lose their claim on it the
        // moment they named the teacher.
        createdById: actor.userId,
        kind: dto.kind as any,
        title: dto.title,
        slug,
        summary: dto.summary?.trim() || null,
        description: dto.description,
        richDescription: dto.richDescription,
        // Absent means MEMBERS_ONLY, from the column. Not spread-conditional
        // like the event equivalent, because here the default is the safe one
        // and letting it apply is the point.
        ...(dto.visibility ? { visibility: dto.visibility as any } : {}),
        payment: (dto.payment ?? 'ARRANGE_DIRECTLY') as any,
        priceCents: dto.priceCents ?? null,
        priceNote: dto.priceNote?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || null,
        imageCredit: dto.imageCredit?.trim() || null,
        imageCreditUrl: dto.imageCreditUrl?.trim() || null,
        ...(dto.imageFocusY !== undefined ? { imageFocusY: dto.imageFocusY } : {}),
        ...(dto.publish ? { isPublished: true, publishedAt: new Date() } : {}),
      },
      select: MEMBER_OFFERING_SELECT,
    });
  }

  async update(orgId: string, id: string, dto: UpdateOfferingDto, actor: Actor) {
    await this.requireEnabled(orgId);
    const offering = await this.loadForActor(orgId, id, actor);

    const kind = (dto.kind ?? offering.kind) as 'WORKSHOP' | 'PRIVATE_LESSON';
    this.assertPaymentMakesSense(kind, dto.payment ?? offering.payment);

    /*
      Turning a workshop into a private lesson, with dates already on it.

      Refused rather than silently detaching them: those sessions are on the
      calendar and may have tickets sold. Somebody has to decide what happens
      to an evening, and it is not this method.
    */
    if (dto.kind === 'PRIVATE_LESSON' && offering.kind === 'WORKSHOP') {
      const sessions = await this.prisma.event.count({ where: { offeringId: id } });
      if (sessions > 0) {
        throw new BadRequestException(
          `This workshop has ${sessions} date${sessions === 1 ? '' : 's'} on the calendar. ` +
            'Remove them before turning it into private lessons.',
        );
      }
    }

    const teacherId =
      dto.teacherId === undefined
        ? undefined
        : await this.resolveTeacher(orgId, actor, dto.teacherId);

    return this.prisma.offering.update({
      where: { id },
      data: {
        ...(dto.kind !== undefined && { kind: dto.kind as any }),
        ...(dto.title !== undefined && {
          title: dto.title,
          slug: await this.uniqueSlug(orgId, dto.title, id),
        }),
        ...(dto.summary !== undefined && { summary: dto.summary?.trim() || null }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.richDescription !== undefined && {
          richDescription: dto.richDescription,
        }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility as any }),
        ...(dto.payment !== undefined && { payment: dto.payment as any }),
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        ...(dto.priceNote !== undefined && { priceNote: dto.priceNote?.trim() || null }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl?.trim() || null }),
        ...(dto.imageCredit !== undefined && {
          imageCredit: dto.imageCredit?.trim() || null,
        }),
        ...(dto.imageCreditUrl !== undefined && {
          imageCreditUrl: dto.imageCreditUrl?.trim() || null,
        }),
        ...(dto.imageFocusY !== undefined && { imageFocusY: dto.imageFocusY }),
        ...(teacherId !== undefined && { teacherId }),
        // `isPublished` and `publishedAt` move together, always — the events
        // module learned that one and a half-published row is unreadable.
        ...(dto.isPublished !== undefined && {
          isPublished: dto.isPublished,
          publishedAt: dto.isPublished ? new Date() : null,
        }),
        ...(dto.closed !== undefined && { closedAt: dto.closed ? new Date() : null }),
      },
      select: MEMBER_OFFERING_SELECT,
    });
  }

  /**
   * Remove an offering.
   *
   * Its sessions survive as plain events — `onDelete: SetNull` — because
   * deleting an offering must not delete an evening somebody holds a ticket
   * to. They become what they already were to everybody who booked them.
   */
  async remove(orgId: string, id: string, actor: Actor) {
    await this.requireEnabled(orgId);
    await this.loadForActor(orgId, id, actor);

    const sessions = await this.prisma.event.count({ where: { offeringId: id } });
    await this.prisma.offering.delete({ where: { id } });

    return { removed: true, sessionsKept: sessions };
  }

  /* ─── Sessions ─────────────────────────────────────────────── */

  /**
   * Put a date on a workshop (TCH-01).
   *
   * Delegates to `EventsService.create`, which is the whole point of modelling
   * a session as an event: slug, co-hosts, room enforcement (SPC-33),
   * recurrence, tickets and the calendar all come from there, already tested.
   *
   * **Visibility is inherited explicitly**, never left to a default. An event
   * with no visibility is PUBLIC, and a session of a members-only offering
   * appearing on the open web would be a leak created by an omission.
   */
  async addSession(orgId: string, id: string, dto: CreateEventDto, actor: Actor) {
    await this.requireEnabled(orgId);
    const offering = await this.loadForActor(orgId, id, actor);

    if (!mayHaveSessions(offering.kind as 'WORKSHOP' | 'PRIVATE_LESSON')) {
      throw new BadRequestException(LESSONS_HAVE_NO_SESSIONS);
    }

    return this.events.create(
      orgId,
      {
        ...dto,
        visibility: (dto.visibility ?? offering.visibility) as any,
        hostId: dto.hostId ?? offering.teacherId,
      },
      actor.userId,
      {
        offeringId: id,
        // A session of a published offering is published. A date nobody can
        // see is not a date.
        publish: dto.publish ?? offering.isPublished,
      },
    );
  }

  /* ─── Reading ──────────────────────────────────────────────── */

  /**
   * What this member may see.
   *
   * The caller never names a visibility — membership is proven by the guard,
   * not claimed by a query parameter — which is the rule `listPublicEvents`
   * keeps and the reason it has never leaked a members-only event.
   *
   * A member additionally sees their *own* drafts, which the audience filter
   * would otherwise hide from the person who wrote them.
   */
  async listForOrg(orgId: string, actor: Actor) {
    await this.requireEnabled(orgId);

    /*
      An organiser sees the lot, including drafts — running what the co-op
      publishes is their job, and the admin console is where an unpublished
      offering gets noticed.

      Everybody else sees what is published and addressed to members, plus
      their own drafts, which the audience filter would otherwise hide from
      the person who wrote them.
    */
    const where = actor.isStaff
      ? { orgId }
      : {
          orgId,
          OR: [
            { isPublished: true, visibility: { in: visibleTo(true) as any } },
            { teacherId: actor.userId },
            { createdById: actor.userId },
          ],
        };

    return this.prisma.offering.findMany({
      where,
      orderBy: [{ closedAt: 'asc' }, { createdAt: 'desc' }],
      select: MEMBER_OFFERING_SELECT,
    });
  }

  async getForOrg(orgId: string, slug: string, actor: Actor) {
    await this.requireEnabled(orgId);

    const offering = await this.prisma.offering.findUnique({
      where: { orgId_slug: { orgId, slug } },
      select: { ...MEMBER_OFFERING_SELECT, teacherId: true, createdById: true },
    });

    // Same message for a miss and a refusal, so slug-probing learns nothing.
    if (!offering) throw new NotFoundException('Offering not found');

    const mayEdit = canEditOffering(offering, actor.userId, actor.isStaff);
    if (!mayEdit && (!offering.isPublished || offering.visibility === 'PRIVATE')) {
      throw new NotFoundException('Offering not found');
    }

    return { ...offering, mayEdit };
  }

  /* ─── Interest ─────────────────────────────────────────────── */

  /**
   * Put your hand up (TCH-01).
   *
   * An upsert, because asking twice is asking once: a member pressing it
   * again is updating their note, not joining a queue a second time.
   *
   * The teacher is emailed best-effort. A failed send must not fail the
   * request — the interest is recorded either way, and the teacher's list is
   * the durable half. Telling the member their enquiry did not go through,
   * when it did, would make them send it again.
   */
  async registerInterest(
    orgId: string,
    id: string,
    dto: OfferingInterestDto,
    userId: string,
  ) {
    await this.requireEnabled(orgId);
    const offering = await this.findInOrg(orgId, id);

    if (!offering.isPublished) {
      throw new NotFoundException('Offering not found');
    }
    if (offering.closedAt) {
      throw new BadRequestException('This is no longer taking anybody.');
    }
    if (offering.teacherId === userId) {
      throw new BadRequestException('This is yours — you are already teaching it.');
    }

    const note = dto.note?.trim() || null;
    await this.prisma.offeringInterest.upsert({
      where: { offeringId_userId: { offeringId: id, userId } },
      create: { offeringId: id, userId, note },
      update: { note, handledAt: null },
    });

    await this.notifyTeacher(offering.id, offering.title, offering.slug, orgId, userId, note);

    return { registered: true };
  }

  private async notifyTeacher(
    offeringId: string,
    title: string,
    slug: string,
    orgId: string,
    learnerId: string,
    note: string | null,
  ) {
    try {
      const [offering, learner, org] = await Promise.all([
        this.prisma.offering.findUnique({
          where: { id: offeringId },
          select: { teacher: { select: { email: true, name: true } } },
        }),
        this.prisma.user.findUnique({
          where: { id: learnerId },
          select: { name: true },
        }),
        this.prisma.organization.findUnique({
          where: { id: orgId },
          // `replyToEmail` because a templated send that names a co-op must
          // say where a reply to it goes (EML-03). A setting that works on
          // some emails and silently not on others is worse than no setting.
          select: { name: true, slug: true, replyToEmail: true },
        }),
      ]);
      if (!offering?.teacher?.email || !org) return;

      const base = (this.config.get<string>('WEB_URL') || 'http://localhost:3000')
        .split(',')[0]
        .trim()
        .replace(/\/+$/, '');

      await this.email.sendTeachingInterest(offering.teacher.email, {
        teacherName: offering.teacher.name ?? null,
        learnerName: learner?.name ?? 'Somebody',
        offeringTitle: title,
        orgName: org.name,
        replyTo: org.replyToEmail,
        note,
        url: `${base}/member/${org.slug}/teaching`,
      });
    } catch (err) {
      // Logged without the note: it is a member writing privately to a
      // teacher, and a log line is a place it would outlive its reader.
      this.logger.warn(
        `Could not tell the teacher about interest in ${offeringId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Who has asked. Teacher, whoever wrote it up, or an organiser. */
  async listInterest(orgId: string, id: string, actor: Actor) {
    await this.requireEnabled(orgId);
    const offering = await this.findInOrg(orgId, id);

    if (!canSeeInterest(offering, actor.userId, actor.isStaff)) {
      throw new ForbiddenException(NOT_YOUR_INTEREST_LIST);
    }

    return this.prisma.offeringInterest.findMany({
      where: { offeringId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        note: true,
        handledAt: true,
        createdAt: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
  }

  /* ─── The open web ─────────────────────────────────────────── */

  /**
   * Every public offering a co-op has, by slug.
   *
   * By slug rather than id for the reason the events embed gives: an admin
   * pastes this into Webflow and should not have to find a uuid.
   *
   * Answers an empty list, not an error, when the co-op has teaching switched
   * off. A marketing page that 500s is worse than one with nothing on it, and
   * the flag is not a secret worth a different status code.
   */
  async listPublic(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        brandColor: true,
        timezone: true,
        teachingEnabled: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const { teachingEnabled, id, ...publicOrg } = org;
    if (!teachingEnabled) return { org: publicOrg, offerings: [] };

    const offerings = await this.prisma.offering.findMany({
      where: {
        orgId: id,
        isPublished: true,
        closedAt: null,
        visibility: { in: visibleTo(false) as any },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        ...PUBLIC_OFFERING_SELECT,
        sessions: {
          ...PUBLIC_OFFERING_SELECT.sessions,
          // A workshop may hold a private rehearsal date. The offering being
          // public says nothing about each evening on it.
          where: {
            isPublished: true,
            canceledAt: null,
            visibility: 'PUBLIC' as any,
            endTime: { gte: new Date() },
          },
          orderBy: { startTime: 'asc' as const },
        },
      },
    });

    return { org: publicOrg, offerings };
  }

  /** The same thing the embed script paints. */
  async listEmbed(orgSlug: string) {
    return this.listPublic(orgSlug);
  }
}
