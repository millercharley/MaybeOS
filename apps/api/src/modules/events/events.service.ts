import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { ContactViewer } from '../../common/access/contact-visibility';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { PublishBookingEventDto } from './dto/publish-booking-event.dto';
import { ConnectService } from '../stripe/connect.service';
import ical, { ICalCalendarMethod } from 'ical-generator';

/* ───────────────────────────── helpers ───────────────────────────── */

function toSlug(title: string, date: string): string {
  const datePrefix = date.slice(0, 10); // YYYY-MM-DD
  const kebab = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${datePrefix}-${kebab}`;
}

/**
 * Attendee counts, in the shape the web actually reads.
 *
 * Every event list in the product renders `event.rsvpCount`; the API only
 * ever sent Prisma's nested `_count.rsvps`. Nothing bridged the two, so the
 * admin capacity bar, the member portal list and the public event page all
 * displayed 0 attendees no matter how many people had RSVPed — and the
 * TypeScript type declaring `rsvpCount?: number` made it look intentional.
 *
 * CONFIRMED only, everywhere. A cancelled RSVP is not an attendee and a
 * waitlisted one is not holding a place, so counting them would overstate a
 * capacity bar. The public event page already counted this way; the org-side
 * lists did not, which meant one event could report two different numbers
 * depending on who was looking at it.
 */
const CONFIRMED_RSVP_COUNT = {
  _count: { select: { rsvps: { where: { status: 'CONFIRMED' as const } } } },
};

/**
 * A few faces from the guest list (delight #3).
 *
 * People decide whether to go based on who else is going, and a row of
 * avatars answers that faster than a number ever will.
 *
 * **Members only, and only on member-facing lists.** Guest RSVPs have no
 * account and no face; and this is deliberately *not* added to the public
 * event list, because a public page showing who is attending would tell a
 * stranger who belongs to this co-op. Charley's rule is that an event link
 * may be public so people can RSVP — not that the guest list is.
 */
const RSVP_FACES = {
  rsvps: {
    where: { status: 'CONFIRMED' as const, userId: { not: null } },
    select: { user: { select: { id: true, name: true, avatarPath: true } } },
    orderBy: { createdAt: 'asc' as const },
    take: 5,
  },
};

function withRsvpFaces<T extends { rsvps?: Array<{ user: unknown }> }>(
  event: T,
): Omit<T, 'rsvps'> & { rsvpFaces: unknown[] } {
  const { rsvps, ...rest } = event;
  // Tolerant of an absent relation on purpose. This is a mapper, not a
  // validator, and the failure it would otherwise cause is a whole event
  // list answering 500 because one optional field was not selected.
  return { ...rest, rsvpFaces: (rsvps ?? []).map((r) => r.user).filter(Boolean) };
}

function withRsvpCount<T extends { _count: { rsvps: number } }>(
  event: T,
): Omit<T, '_count'> & { rsvpCount: number } {
  const { _count, ...rest } = event;
  return { ...rest, rsvpCount: _count.rsvps };
}

/* ───────────────────────────── service ───────────────────────────── */

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Cancelling an event has to return anyone's money (D-013 ticketing).
    private readonly connectService: ConnectService,
    // Somebody moved up off the waitlist has to be told (EVT-16).
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /* ─── Create ────────────────────────────────────────────────── */

  /**
   * Publish an event from a room booking (EVT-05).
   *
   * The member has already said when and where by booking the room; asking
   * them to type it again is how the two drift apart. Time, room and title
   * come from the booking, and the event stays linked to it so the booking
   * lifecycle can reach it.
   *
   * Refused unless the booking is APPROVED. A PENDING booking is a request,
   * and advertising a public event for a room the co-op has not agreed to
   * hand over is the one failure mode this feature can cause that the member
   * cannot undo — people will already have seen it.
   */
  async createFromBooking(
    orgId: string,
    bookingId: string,
    userId: string,
    isStaff: boolean,
    dto: PublishBookingEventDto,
  ) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, room: { orgId } },
      include: { room: true, event: { select: { id: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.userId !== userId && !isStaff) {
      throw new ForbiddenException('That booking is not yours');
    }
    if (booking.event) {
      throw new ConflictException('This booking already has an event');
    }
    if (booking.status !== 'APPROVED') {
      throw new BadRequestException(
        `This booking is ${booking.status.toLowerCase()}. Only a confirmed booking can be published as an event.`,
      );
    }
    if (booking.endTime < new Date()) {
      throw new BadRequestException('That booking has already finished');
    }

    return this.create(
      orgId,
      {
        title: dto.title ?? booking.title,
        description: dto.description,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        roomId: booking.roomId,
        visibility: dto.visibility ?? 'MEMBERS_ONLY',
        capacity: dto.capacity ?? booking.room.capacity ?? undefined,
        category: dto.category,
      } as CreateEventDto,
      userId,
      { bookingId: booking.id, publish: dto.publish ?? true },
    );
  }

  async create(
    orgId: string,
    dto: CreateEventDto,
    userId: string,
    options: { bookingId?: string; publish?: boolean } = {},
  ) {
    const slug = toSlug(dto.title, dto.startTime);

    // Ensure slug uniqueness within the org
    const existing = await this.prisma.event.findUnique({
      where: { orgId_slug: { orgId, slug } },
    });

    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    return this.prisma.event.create({
      data: {
        orgId,
        slug: finalSlug,
        title: dto.title,
        description: dto.description,
        richDescription: dto.richDescription,
        locationId: dto.locationId,
        roomId: dto.roomId,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        timezone: dto.timezone,
        visibility: dto.visibility as any,
        recurrence: dto.recurrence as any,
        recurrenceEnd: dto.recurrenceEnd ? new Date(dto.recurrenceEnd) : undefined,
        capacity: dto.capacity,
        priceCents: dto.priceCents ?? null,
        // The creator hosts by default (EVT-04). An organiser making an event
        // on somebody else's behalf reassigns it; until they do, the person
        // who made it is the one who answers for it.
        hostId: dto.hostId ?? userId,
        bookingId: options.bookingId,
        // A member publishing their own event means it goes live. Leaving it
        // as a draft they cannot publish would be a dead end — the point of
        // the feature is that they can share it.
        ...(options.publish ?? dto.publish
          ? { isPublished: true, publishedAt: new Date() }
          : {}),
        waitlistEnabled: dto.waitlistEnabled,
        category: dto.category,
        tags: dto.tags,
      },
    });
  }

  /* ─── Update ────────────────────────────────────────────────── */

  /**
   * Load an event and confirm it belongs to the org in the URL (SEC-04).
   *
   * Every method below took a bare `eventId`, and the controller named its
   * route param `_orgId` — underscore-prefixed, the convention for a value
   * deliberately ignored. The org was not overlooked so much as discarded.
   *
   * The guards did not cover the gap either. `RolesGuard` does check
   * `user.orgRoles[orgId]`, so the admin-only routes (update, publish,
   * cancel, check-in) at least required a role *in the org named in the
   * URL* — but the caller writes that URL, so pairing your own org id with
   * another co-op's event id was enough to edit, publish or cancel it.
   *
   * NotFound rather than Forbidden, as in SPC-02, IMP-01 and CMN-07.
   */
  private async findEventInOrg(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  /**
   * Load an event the actor is allowed to change (EVT-05).
   *
   * Members can now create events, so they need to be able to edit and cancel
   * the ones they host — otherwise the feature hands somebody a thing they
   * cannot correct or call off. Organisers may change any event in their org,
   * which is what running the space means.
   *
   * Forbidden rather than NotFound here, unlike the tenant checks: the event
   * belongs to a co-op the caller is already a member of, so its existence is
   * not the secret. What is being refused is authorship, and saying so is
   * more use than pretending the event is missing.
   */
  /**
   * Whoever may act on this event: an organiser, or the person hosting it.
   *
   * Check-in reaches for this too. The door list was ADMIN/STAFF only, which
   * put an organiser at the door of every event a member ran — Charley, 2026-08-19:
   * "the host of the event is responsible for checking in guests not the admin."
   */
  private async loadEventForActor(
    orgId: string,
    eventId: string,
    userId: string,
    isStaff: boolean,
  ) {
    const event = await this.findEventInOrg(orgId, eventId);
    if (!isStaff && event.hostId !== userId) {
      throw new ForbiddenException('Only the host or an organiser can change this event');
    }
    return event;
  }

  async update(
    orgId: string,
    eventId: string,
    dto: UpdateEventDto,
    actor: { userId: string; isStaff: boolean },
  ) {
    const event = await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    // Only an organiser reassigns a host. A member handing their event to
    // somebody else would be volunteering them for the follow-up email.
    if (dto.hostId !== undefined && !actor.isStaff) {
      throw new ForbiddenException('Only an organiser can change who hosts an event');
    }

    // If title or startTime changed, regenerate slug
    let slug: string | undefined;
    if (dto.title || dto.startTime) {
      const newTitle = dto.title ?? event.title;
      const newDate = dto.startTime ?? event.startTime.toISOString();
      slug = toSlug(newTitle, newDate);

      const existing = await this.prisma.event.findUnique({
        where: { orgId_slug: { orgId: event.orgId, slug } },
      });

      if (existing && existing.id !== eventId) {
        slug = `${slug}-${Date.now()}`;
      }
    }

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.richDescription !== undefined && { richDescription: dto.richDescription }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.roomId !== undefined && { roomId: dto.roomId }),
        ...(dto.startTime !== undefined && { startTime: new Date(dto.startTime) }),
        ...(dto.endTime !== undefined && { endTime: new Date(dto.endTime) }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility as any }),
        ...(dto.recurrence !== undefined && { recurrence: dto.recurrence as any }),
        ...(dto.recurrenceEnd !== undefined && {
          recurrenceEnd: new Date(dto.recurrenceEnd),
        }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        // Null is meaningful: it makes a ticketed event free again.
        ...(dto.priceCents !== undefined && { priceCents: dto.priceCents }),
        // `null` clears the host deliberately, so `!== undefined` rather than
        // a truthiness check — an event can legitimately have nobody running it.
        ...(dto.hostId !== undefined && { hostId: dto.hostId }),
        ...(dto.waitlistEnabled !== undefined && { waitlistEnabled: dto.waitlistEnabled }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(slug && { slug }),
      },
    });
  }

  /* ─── Publish ───────────────────────────────────────────────── */

  async publish(
    orgId: string,
    eventId: string,
    actor: { userId: string; isStaff: boolean },
  ) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
    });
  }

  /* ─── Cancel ────────────────────────────────────────────────── */

  /**
   * Cancel an event, refunding anyone who paid.
   *
   * The cancel is written first and never made conditional on the refunds.
   * If Stripe is unreachable, people still need to be told the event is off —
   * an event that stays "live" because a refund failed is the worse outcome,
   * and the money can be returned on a retry while a wasted journey cannot.
   *
   * The refund summary comes back with the event so the caller can say what
   * actually happened rather than implying everyone has their money.
   */
  async cancel(
    orgId: string,
    eventId: string,
    actor: { userId: string; isStaff: boolean },
  ) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { canceledAt: new Date() },
    });

    const refunds = await this.refundTicketsFor(orgId, eventId);
    return { ...event, refunds };
  }

  /**
   * Return everyone's money for an event that is no longer happening.
   *
   * Kept here rather than in the caller because *every* route to a cancelled
   * event has to do it — an organiser cancelling directly, and a member
   * cancelling the room booking the event was published from (EVT-05). The
   * second is easy to miss and is the one that will happen most.
   */
  private async refundTicketsFor(orgId: string, eventId: string) {
    try {
      return await this.connectService.refundEventTickets(orgId, eventId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.logger.error(`Event ${eventId} cancelled but refunds failed: ${message}`);
      return { attempted: 0, refunded: 0, failed: [], error: message };
    }
  }

  /**
   * Keep an event in step with the booking it was published from (EVT-05).
   *
   * Called by SpaceService when a booking is cancelled, rejected or moved.
   * Without this, cancelling a room booking leaves the co-op advertising an
   * event in a room it no longer holds, and everyone who RSVPed still turns
   * up — the failure the member cannot undo, because people have already
   * read it.
   *
   * Cancelled rather than deleted: the RSVPs are a record of who intended to
   * come, and "this was called off" is information. Same reasoning as
   * cancelled RSVPs being shown rather than dropped.
   */
  async syncWithBooking(
    bookingId: string,
    change: { startTime?: Date; endTime?: Date; canceled?: boolean },
  ) {
    const event = await this.prisma.event.findUnique({
      where: { bookingId },
      // orgId so cancelling can scope its refunds; this lookup is by booking,
      // which is itself tenant-owned, so the event is reached through it.
      select: { id: true, canceledAt: true, orgId: true },
    });
    if (!event) return null;

    const updated = await this.prisma.event.update({
      where: { id: event.id },
      data: {
        ...(change.startTime ? { startTime: change.startTime } : {}),
        ...(change.endTime ? { endTime: change.endTime } : {}),
        // Never un-cancel: an event called off stays called off even if the
        // booking somehow returns, because people were already told.
        ...(change.canceled && !event.canceledAt ? { canceledAt: new Date() } : {}),
      },
    });

    // Cancelling the room refunds the tickets. This is the path that will
    // actually be taken — a member cancels a booking without necessarily
    // thinking about the people who bought tickets to what they booked it for.
    if (change.canceled && !event.canceledAt) {
      await this.refundTicketsFor(event.orgId, event.id);
    }

    return updated;
  }

  /* ─── Find by ID ────────────────────────────────────────────── */

  async findById(orgId: string, eventId: string, viewer: ContactViewer) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        rsvps: true,
        room: true,
        location: true,
        // Deliberately not on the public endpoints. Publishing a member's
        // name to anyone on the internet is a decision the co-op should make,
        // not a default that arrives with a schema change (see SEC-06).
        host: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    // The detail route already ships the full RSVP list, so the count comes
    // from that rather than a second query — but it must still be *present*,
    // and mean the same thing it means in the lists.
    const rsvpCount = event.rsvps.filter((r) => r.status === 'CONFIRMED').length;

    // An attendee list is contact information: `guestEmail` is a raw address,
    // and `note` is whatever someone wrote to the organisers — "I use a
    // wheelchair", "I'm bringing my ex's kids". Organisers need both to run
    // the event. Another member needs neither, and this route was open to
    // every member of the org.
    if (!viewer.privileged) {
      return {
        ...event,
        // Their own RSVP stays: that is how the page knows they are going.
        rsvps: event.rsvps.filter((r) => r.userId === viewer.userId),
        rsvpCount,
      };
    }

    return { ...event, rsvpCount };
  }

  /* ─── List by Org (paginated) ───────────────────────────────── */

  async listByOrg(
    orgId: string,
    filters: {
      visibility?: string;
      category?: string;
      from?: string;
      to?: string;
      page?: number;
      perPage?: number;
    },
  ) {
    const page = filters.page ?? 1;
    const perPage = filters.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: any = { orgId };

    if (filters.visibility) {
      where.visibility = filters.visibility;
    }
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.from || filters.to) {
      where.startTime = {};
      if (filters.from) where.startTime.gte = new Date(filters.from);
      if (filters.to) where.startTime.lte = new Date(filters.to);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip,
        take: perPage,
        include: {
          location: true,
          room: true,
          host: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } },
          ...CONFIRMED_RSVP_COUNT,
          ...RSVP_FACES,
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: data.map((event) => withRsvpFaces(withRsvpCount(event))),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * The public events of a co-op, found by its slug, for the website embed.
   *
   * By slug because an admin pastes this into Webflow or Squarespace and
   * should not have to find a uuid to do it. Public and unauthenticated by
   * design: it answers exactly what the co-op's own public events page already
   * shows to anybody, and nothing else.
   *
   * Trimmed rather than passed through whole. An endpoint that any website can
   * read should return the smallest thing that renders a listing, so that
   * widening the model later cannot quietly start publishing more than a co-op
   * agreed to — RSVP counts, host identities and internal ids stay here.
   */
  async listEmbedEvents(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const { data } = await this.listPublicEvents(org.id, { perPage: 50 });

    return {
      org: { name: org.name, slug: org.slug },
      events: data.map((event) => ({
        title: event.title,
        slug: event.slug,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location?.name ?? event.room?.name ?? null,
        priceCents: event.priceCents ?? null,
        currency: event.currency ?? 'usd',
      })),
    };
  }

  /**
   * The post that carries an event's discussion (EVT-11).
   *
   * An event carries a post rather than comments learning about events
   * (Charley, 2026-08-19). The alternative would have given every comment
   * query and every moderation path two shapes to handle forever; this way
   * there is one comment model, one moderation surface, one notification path,
   * and `isFlagged` keeps working without knowing events exist.
   *
   * Created on demand, not for every event. Most events are never discussed,
   * and a post per event would fill a co-op's Commons with empty threads.
   *
   * It lives in a channel called Events, made once per co-op. That channel is
   * deliberately real rather than hidden: a co-op that discusses an event is
   * having a conversation, and burying it somewhere the Commons cannot see
   * would mean two places to look for the same thing.
   */
  async ensureEventThread(orgId: string, eventId: string, authorId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: { id: true, title: true, slug: true, postId: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (event.postId) return { postId: event.postId };

    // Upsert rather than find-then-create: the unique index on (orgId, slug)
    // is what actually decides, and two members opening two event pages at
    // the same second would otherwise both try to create the channel.
    const channel = await this.prisma.channel.upsert({
      where: { orgId_slug: { orgId, slug: 'events' } },
      create: {
        orgId,
        name: 'Events',
        slug: 'events',
        description: 'Conversation about what the co-op has coming up.',
      },
      update: {},
      select: { id: true },
    });

    const post = await this.prisma.post.create({
      data: {
        channelId: channel.id,
        authorId,
        title: event.title,
        // Deliberately thin. The event page is where the detail lives, and a
        // copy here would be a second version of the truth to keep in step.
        body: `Discussion for ${event.title}.`,
      },
      select: { id: true },
    });

    // Two members opening the page at once each create a post, and the unique
    // index does not stop them — the ids differ, so both updates would
    // succeed and the second would orphan the first thread, comments and all.
    // Claiming the event only while `postId` is still null is what makes one
    // of them lose, and the loser cleans up after itself.
    const claimed = await this.prisma.event.updateMany({
      where: { id: event.id, postId: null },
      data: { postId: post.id },
    });

    if (claimed.count === 1) return { postId: post.id };

    await this.prisma.post.delete({ where: { id: post.id } }).catch(() => {});
    const settled = await this.prisma.event.findFirst({
      where: { id: event.id, orgId },
      select: { postId: true },
    });
    return { postId: settled?.postId ?? null };
  }

  /* ─── List Public Events ────────────────────────────────────── */

  /**
   * What a viewer may see on a co-op's portal.
   *
   * `viewerIsMember` widens this from PUBLIC to PUBLIC + MEMBERS_ONLY, and
   * nothing else — the caller never names a visibility, so a member cannot ask
   * for PRIVATE and an anonymous request cannot ask for anything.
   *
   * The default for a new event is MEMBERS_ONLY (`create`, above), and this
   * listing was PUBLIC-only for everybody. So a co-op creating an event the
   * ordinary way got one that was **invisible on its own portal, to its own
   * members** — and would reasonably conclude events were broken rather than
   * that the default and the listing disagreed. Charley hit exactly that on
   * 2026-08-18 with the first real event.
   *
   * PRIVATE stays unlisted for everyone, which is what the word promises. A
   * member can still open one by id — `getPublicEvent`'s member branch allows
   * it — so PRIVATE means "not advertised", not "sealed".
   */
  async listPublicEvents(
    orgId: string,
    filters: {
      category?: string;
      from?: string;
      to?: string;
      page?: number;
      perPage?: number;
    },
    viewerIsMember = false,
  ) {
    const page = filters.page ?? 1;
    const perPage = filters.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: any = {
      orgId,
      visibility: viewerIsMember ? { in: ['PUBLIC', 'MEMBERS_ONLY'] } : 'PUBLIC',
      isPublished: true,
      canceledAt: null,
    };

    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.from || filters.to) {
      where.startTime = {};
      if (filters.from) where.startTime.gte = new Date(filters.from);
      if (filters.to) where.startTime.lte = new Date(filters.to);
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where,
        orderBy: { startTime: 'asc' },
        skip,
        take: perPage,
        include: {
          location: true,
          room: true,
          ...CONFIRMED_RSVP_COUNT,
          // Faces for members, never for the public list. The rule is the
          // same one that widens visibility above: an event link may be
          // public so strangers can RSVP, but who is attending is not — a
          // guest list on a public page tells anyone with the URL who belongs
          // to this co-op.
          ...(viewerIsMember ? RSVP_FACES : {}),
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: data.map((event) => withRsvpFaces(withRsvpCount(event))),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /* ─── Public Event by Slug ──────────────────────────────────── */

  async getPublicEventBySlug(orgSlug: string, eventSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const event = await this.prisma.event.findUnique({
      where: { orgId_slug: { orgId: org.id, slug: eventSlug } },
      include: {
        location: true,
        room: true,
        // No host here, deliberately. Who runs an event is half of why
        // somebody comes, but this endpoint answers to the open internet and
        // an admin ticking "public" agreed to publish the event, not to
        // publish a member's name. Signed-in members read the host from the
        // org-scoped endpoint instead.
        org: { select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true } },
        ...CONFIRMED_RSVP_COUNT,
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    if (event.visibility !== 'PUBLIC' || !event.isPublished) {
      throw new NotFoundException('Event not found');
    }

    return withRsvpCount(event);
  }

  /* ─── RSVP ──────────────────────────────────────────────────── */

  /**
   * RSVP to an event.
   *
   * `userId` is null for the guest route, which has no guards at all. That
   * route existed so a stranger can RSVP to a public event — but nothing
   * checked that the event *was* public, or published, or even that it
   * belonged to the org in the URL. Anyone who knew or guessed an event's
   * UUID could RSVP to another co-op's unpublished, PRIVATE event, and land
   * their name on its attendee list.
   *
   * The rule now: the event must belong to the org in the path, and anyone
   * who is not a member of that org may only RSVP to an event the org is
   * already publishing to the world — the same predicate `listPublicEvents`
   * uses. Members are unaffected, so no existing behaviour changes for them.
   */
  async rsvp(orgId: string, eventId: string, userId: string | null, dto: RsvpDto) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: { _count: { select: { rsvps: { where: { status: 'CONFIRMED' } } } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.canceledAt) throw new BadRequestException('Event has been canceled');

    const isMember = userId
      ? Boolean(
          await this.prisma.userOrg.findFirst({
            where: { orgId, userId },
            select: { id: true },
          }),
        )
      : false;

    if (!isMember && !(event.visibility === 'PUBLIC' && event.isPublished)) {
      // Deliberately the same message a missing event gets: a stranger
      // probing ids should not be able to tell "no such event" from "exists
      // but is not public".
      throw new NotFoundException('Event not found');
    }

    // Check for existing RSVP
    if (userId) {
      const existing = await this.prisma.rsvp.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });
      if (existing && existing.status !== 'CANCELED') {
        throw new ConflictException('You have already RSVPed to this event');
      }

      // If previously canceled, update instead of create
      if (existing && existing.status === 'CANCELED') {
        const status = this.determineRsvpStatus(event);
        return this.prisma.rsvp.update({
          where: { id: existing.id },
          data: {
            status,
            plusOnes: dto.plusOnes ?? 0,
            note: dto.note,
            checkedIn: false,
            checkedInAt: null,
          },
        });
      }
    }

    const status = this.determineRsvpStatus(event);

    return this.prisma.rsvp.create({
      data: {
        eventId,
        userId,
        guestName: dto.guestName,
        guestEmail: dto.guestEmail,
        status,
        plusOnes: dto.plusOnes ?? 0,
        note: dto.note,
      },
    });
  }

  private determineRsvpStatus(event: {
    capacity: number | null;
    waitlistEnabled: boolean;
    _count: { rsvps: number };
  }): 'CONFIRMED' | 'WAITLISTED' {
    if (event.capacity !== null && event._count.rsvps >= event.capacity) {
      if (event.waitlistEnabled) {
        return 'WAITLISTED';
      }
      throw new BadRequestException('Event is at capacity');
    }
    return 'CONFIRMED';
  }

  /**
   * Every event this member has RSVPed to in one org (EVT-01).
   *
   * Mirrors SpaceOS's `listUserBookings`. Canceled RSVPs are included rather
   * than hidden: "you cancelled this" is information, and dropping the row
   * makes an event the member remembers responding to simply vanish.
   */
  async listUserRsvps(orgId: string, userId: string) {
    const rsvps = await this.prisma.rsvp.findMany({
      where: { userId, event: { orgId } },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            slug: true,
            startTime: true,
            endTime: true,
            timezone: true,
            canceledAt: true,
            capacity: true,
            location: { select: { name: true } },
            room: { select: { name: true } },
          },
        },
      },
      orderBy: { event: { startTime: 'asc' } },
    });

    // An event the org cancelled matters more to a member than their own RSVP
    // status, so it is surfaced rather than left to be inferred from a date.
    return rsvps.map((rsvp) => ({
      ...rsvp,
      eventCanceled: rsvp.event.canceledAt !== null,
      isPast: rsvp.event.endTime < new Date(),
    }));
  }

  /**
   * Events this member hosts (EVT-05).
   *
   * Creating an event is only half of it — they need somewhere to find the
   * thing they made, see whether anyone is coming, and correct or call it
   * off. Drafts included: an unpublished event is invisible everywhere else,
   * so this is the only place it can be finished.
   */
  async listHostedEvents(orgId: string, userId: string) {
    const events = await this.prisma.event.findMany({
      where: { orgId, hostId: userId },
      orderBy: { startTime: 'desc' },
      include: {
        location: { select: { name: true } },
        room: { select: { name: true } },
        ...CONFIRMED_RSVP_COUNT,
      },
    });

    return events.map((event) => ({
      ...withRsvpCount(event),
      isPast: event.endTime < new Date(),
    }));
  }

  /* ─── Cancel RSVP ──────────────────────────────────────────── */

  async cancelRsvp(orgId: string, eventId: string, userId: string) {
    await this.findEventInOrg(orgId, eventId);

    const rsvp = await this.prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (!rsvp) throw new NotFoundException('RSVP not found');

    const wasConfirmed = rsvp.status === 'CONFIRMED';

    await this.prisma.rsvp.update({
      where: { id: rsvp.id },
      data: { status: 'CANCELED' },
    });

    // Promote the first waitlisted RSVP if a confirmed spot opened up
    if (wasConfirmed) {
      const firstWaitlisted = await this.prisma.rsvp.findFirst({
        where: { eventId, status: 'WAITLISTED' },
        orderBy: { createdAt: 'asc' },
      });

      if (firstWaitlisted) {
        await this.prisma.rsvp.update({
          where: { id: firstWaitlisted.id },
          data: { status: 'CONFIRMED' },
        });

        // Told, not just promoted (EVT-16). Until this existed the row simply
        // changed and the member found out if they happened to open the page
        // again — so a co-op freed a seat, gave it to somebody, and had them
        // not turn up.
        await this.notifyPromoted(orgId, firstWaitlisted.id);
      }
    }

    return { message: 'RSVP canceled' };
  }

  /* ─── Check-in ──────────────────────────────────────────────── */

  /**
   * The door list for an event (IMP-10).
   *
   * Attendance was structurally zero across the whole product: the check-in
   * path below has existed since EventOS was built and no screen has ever
   * called it, so the `attendance` table held 0 rows against 13 RSVPs and the
   * impact dashboard's reach figures could only ever report nothing.
   *
   * Shaped for the job it is used for — standing at a door, matching a face
   * to a row. Confirmed and waitlisted only: someone who cancelled is not
   * expected, and showing them invites checking in the wrong person. Sorted
   * by name so the list reads the way a person scans it, not by RSVP time.
   */
  /**
   * How it went, for the person who hosted it (delight #5).
   *
   * Only after the event has ended: a "summary" of something that has not
   * happened is a forecast, and hosts read the two very differently.
   *
   * The money is reported in three lines rather than one, because a host who
   * sees only what they are owed cannot tell whether a low number means few
   * tickets or a large share to the co-op. Gross, the co-op's share, and what
   * is left — and where a payout row exists those figures come from it rather
   * than being recomputed, so what a host reads here is what the co-op will
   * actually pay (EVT-15).
   *
   * Attendance is check-ins where anybody checked in, and confirmed RSVPs
   * where nobody did — with which of the two it is, said plainly. A door
   * nobody scanned is not an event nobody came to.
   */
  async hostSummary(orgId: string, eventId: string, userId: string, isStaff: boolean) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        title: true,
        slug: true,
        startTime: true,
        endTime: true,
        hostId: true,
        rsvps: { select: { status: true, checkedIn: true, plusOnes: true } },
        payout: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (!isStaff && event.hostId !== userId) {
      // Not 403: whether somebody else's event exists is not this member's
      // business either.
      throw new NotFoundException('Event not found');
    }

    const ended = event.endTime !== null && event.endTime <= new Date();
    if (!ended) return { event, ended: false as const };

    const confirmed = event.rsvps.filter((r) => r.status === 'CONFIRMED');
    const checkedIn = confirmed.filter((r) => r.checkedIn);
    const expected = confirmed.reduce((n, r) => n + 1 + r.plusOnes, 0);

    return {
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        startTime: event.startTime,
        endTime: event.endTime,
      },
      ended: true as const,
      attendance: {
        expected,
        checkedIn: checkedIn.length,
        // Which number this is, said rather than implied. A door nobody
        // scanned is not an event nobody came to.
        basis: checkedIn.length > 0 ? ('check-ins' as const) : ('rsvps' as const),
        counted: checkedIn.length > 0 ? checkedIn.length : expected,
      },
      money: event.payout
        ? {
            ticketCount: event.payout.ticketCount,
            refundedCount: event.payout.refundedCount,
            grossCents: event.payout.grossCents,
            // Stated as a figure rather than left for the host to subtract.
            coopShareCents: event.payout.grossCents - event.payout.amountCents,
            netCents: event.payout.amountCents,
            status: event.payout.status,
            paidAt: event.payout.paidAt,
          }
        : null,
    };
  }

  async listAttendees(orgId: string, eventId: string, actor: { userId: string; isStaff: boolean }) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const [rsvps, attendance] = await Promise.all([
      this.prisma.rsvp.findMany({
        where: { eventId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
        include: { user: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } } },
      }),
      this.prisma.attendance.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Walk-ins are the rows `recordWalkIn` wrote, identified by their method.
    // Selecting on `userId: null` instead looked right and was not: a *guest*
    // RSVP also has no user, so checking one in showed them on the door list
    // and again as a walk-in, and counted them twice.
    const walkIns = attendance.filter((a) => a.method === 'self');

    const expected = rsvps
      .map((rsvp) => ({
        rsvpId: rsvp.id,
        userId: rsvp.userId,
        name: rsvp.user?.name ?? rsvp.guestName ?? 'Guest',
        avatarUrl: rsvp.user?.avatarUrl ?? null,
        isGuest: rsvp.userId === null,
        status: rsvp.status,
        plusOnes: rsvp.plusOnes,
        checkedIn: rsvp.checkedIn,
        checkedInAt: rsvp.checkedInAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      expected,
      walkIns: walkIns.map((w) => ({
        attendanceId: w.id,
        name: w.guestName ?? 'Walk-in',
        createdAt: w.createdAt,
      })),
      /**
       * Counted off the attendance table itself — the same rows the impact
       * dashboard aggregates — rather than added up from RSVP flags and
       * walk-ins separately. Two independent sums of the same evening will
       * eventually disagree, and the first version of this did.
       */
      attendanceCount: attendance.length,
      expectedCount: rsvps.filter((r) => r.status === 'CONFIRMED').length,
    };
  }

  /**
   * Mark an RSVP as arrived.
   *
   * Keyed on the RSVP rather than a user id, which is what the previous
   * signature took: a guest RSVP has no user, so the only people who could
   * ever have been checked in were members — and guests are exactly who a
   * co-op most needs counted for reach.
   *
   * Writes both `Rsvp.checkedIn` and an `Attendance` row in one transaction.
   * Two mechanisms existed and neither was authoritative; keeping them in step
   * is what makes the flag usable on the door list and the table usable as the
   * event log the dashboard aggregates.
   */
  async checkIn(orgId: string, eventId: string, rsvpId: string, actor: { userId: string; isStaff: boolean }) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const rsvp = await this.prisma.rsvp.findFirst({ where: { id: rsvpId, eventId } });
    if (!rsvp) throw new NotFoundException('RSVP not found');
    if (rsvp.status === 'CANCELED') {
      throw new BadRequestException('This RSVP was cancelled');
    }
    // Idempotent: tapping a name twice on a door list is a slip, not an error
    // worth refusing. It used to answer 400, which on a queue reads as a fault.
    if (rsvp.checkedIn) {
      return { rsvp, alreadyCheckedIn: true };
    }

    const [updatedRsvp] = await this.prisma.$transaction([
      this.prisma.rsvp.update({
        where: { id: rsvp.id },
        data: { checkedIn: true, checkedInAt: new Date() },
      }),
      this.prisma.attendance.create({
        data: {
          eventId,
          userId: rsvp.userId,
          guestEmail: rsvp.userId ? null : rsvp.guestEmail,
          method: 'manual',
        },
      }),
    ]);

    return { rsvp: updatedRsvp, alreadyCheckedIn: false };
  }

  /**
   * Undo a check-in.
   *
   * There was no way back: `checkIn` refused a second call with "Already
   * checked in" and nothing cleared the flag, so one mis-tap on a door list
   * permanently overstated attendance — in a table whose whole purpose is to
   * be counted in a report.
   */
  async undoCheckIn(orgId: string, eventId: string, rsvpId: string, actor: { userId: string; isStaff: boolean }) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const rsvp = await this.prisma.rsvp.findFirst({ where: { id: rsvpId, eventId } });
    if (!rsvp) throw new NotFoundException('RSVP not found');

    const [updatedRsvp] = await this.prisma.$transaction([
      this.prisma.rsvp.update({
        where: { id: rsvp.id },
        data: { checkedIn: false, checkedInAt: null },
      }),
      // Remove the attendance this check-in created, not every row for the
      // person: deleteMany with the same predicate the write used.
      this.prisma.attendance.deleteMany({
        where: rsvp.userId
          ? { eventId, userId: rsvp.userId }
          : { eventId, userId: null, guestEmail: rsvp.guestEmail },
      }),
    ]);

    return updatedRsvp;
  }

  /**
   * Record somebody who turned up without an RSVP.
   *
   * Without this, attendance is bounded by RSVPs — which is the structural
   * undercount IMP-10 is about, just a smaller one. A co-op's open evening is
   * mostly people who did not RSVP, and the PRD leans on reach indicators
   * precisely because they cost no fatigue budget.
   */
  async recordWalkIn(
    orgId: string,
    eventId: string,
    actor: { userId: string; isStaff: boolean },
    name?: string,
  ) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    return this.prisma.attendance.create({
      data: {
        eventId,
        userId: null,
        guestName: name?.trim() || null,
        method: 'self',
      },
    });
  }

  /* ─── JSON Feed ─────────────────────────────────────────────── */

  async getEventJsonFeed(orgId: string) {
    const events = await this.prisma.event.findMany({
      where: {
        orgId,
        visibility: 'PUBLIC',
        isPublished: true,
        canceledAt: null,
      },
      orderBy: { startTime: 'asc' },
      include: {
        location: true,
        room: true,
      },
    });

    return events.map((event) => ({
      id: event.id,
      title: event.title,
      slug: event.slug,
      description: event.description,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      timezone: event.timezone,
      category: event.category,
      tags: event.tags,
      location: event.location
        ? {
            name: event.location.name,
            address: event.location.address,
            city: event.location.city,
            state: event.location.state,
          }
        : null,
      room: event.room ? { name: event.room.name } : null,
      imageUrl: event.imageUrl,
    }));
  }

  /* ─── ICS Feed ──────────────────────────────────────────────── */

  async getEventIcsFeed(orgId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const events = await this.prisma.event.findMany({
      where: {
        orgId,
        visibility: 'PUBLIC',
        isPublished: true,
        canceledAt: null,
      },
      orderBy: { startTime: 'asc' },
      include: { location: true },
    });

    const calendar = ical({
      name: `${org.name} Events`,
      method: ICalCalendarMethod.PUBLISH,
      prodId: { company: org.name, product: 'MaybeOS Events' },
      timezone: org.timezone,
    });

    for (const event of events) {
      const calEvent = calendar.createEvent({
        id: event.id,
        start: event.startTime,
        end: event.endTime,
        timezone: event.timezone,
        summary: event.title,
        description: event.description ?? undefined,
      });

      if (event.location) {
        const parts = [event.location.name];
        if (event.location.address) parts.push(event.location.address);
        if (event.location.city) parts.push(event.location.city);
        if (event.location.state) parts.push(event.location.state);
        calEvent.location(parts.join(', '));
      }

      if (event.category) {
        calEvent.categories([{ name: event.category }]);
      }
    }

    return calendar.toString();
  }

  /**
   * Tell the member who just moved up off the waitlist.
   *
   * Failures are swallowed on purpose, the same way booking emails do it: the
   * promotion already happened and is correct, and throwing here would fail
   * the *cancellation* that caused it — leaving the person who cancelled still
   * holding a place they gave up.
   */
  private async notifyPromoted(orgId: string, rsvpId: string): Promise<void> {
    try {
      // Resolved through its org, not by bare id (SEC-04) — even here, where
      // the id came from a query already scoped to the event.
      const rsvp = await this.prisma.rsvp.findFirst({
        where: { id: rsvpId, event: { orgId } },
        select: {
          user: { select: { email: true, name: true } },
          event: {
            select: {
              title: true,
              slug: true,
              startTime: true,
              timezone: true,
              org: { select: { name: true, slug: true } },
            },
          },
        },
      });

      // A guest RSVP has no account and no address on the row.
      if (!rsvp?.user?.email) return;

      const appUrl = this.configService.get<string>('APP_URL') ?? 'https://maybeos.org';

      await this.emailService.sendWaitlistPromoted(rsvp.user.email, {
        memberName: rsvp.user.name ?? 'there',
        orgName: rsvp.event.org.name,
        eventTitle: rsvp.event.title,
        // In the event's timezone, not the server's — SPC-08 was this same
        // bug in booking emails, where a 10am booking arrived as 3pm.
        when: rsvp.event.startTime.toLocaleString('en-US', {
          timeZone: rsvp.event.timezone,
          dateStyle: 'full',
          timeStyle: 'short',
        }),
        eventUrl: `${appUrl}/portal/${rsvp.event.org.slug}/events/${rsvp.event.slug}`,
      });
    } catch (err) {
      this.logger.warn(`Could not send waitlist promotion for ${rsvpId}: ${String(err)}`);
    }
  }
}
