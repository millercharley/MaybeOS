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
import { RadarService } from '../radar/radar.service';
import { ContactViewer } from '../../common/access/contact-visibility';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
import { canEditEvent, canManageHosts, coHostProblem, NOT_YOURS, NOT_YOUR_EVENT } from './host-control';
import { attachProblem, whoseRoomsCount } from './event-rooms';
import { describeRecurrence, horizonFrom, occurrencesOf } from './recurrence';
import { RepeatEventDto } from './dto/repeat-event.dto';
import { CloneEventDto } from './dto/clone-event.dto';
import { PublishBookingEventDto } from './dto/publish-booking-event.dto';
import { ConnectService } from '../stripe/connect.service';
import ical, { ICalCalendarMethod } from 'ical-generator';
import { PUBLIC_EVENT_SELECT } from './event-view';
import { escapeHtml } from '../../common/escape-html';

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

// `T extends object`, not a shape with an optional `rsvps`: a public event row
// has no `rsvps` key at all (SEC-12), and an optional-only constraint rejects
// an object sharing none of its properties. The tolerance below was always the
// intent; this makes the signature say so.
function withRsvpFaces<T extends object>(
  event: T,
): Omit<T, 'rsvps'> & { rsvpFaces: unknown[] } {
  const { rsvps, ...rest } = event as T & { rsvps?: Array<{ user: unknown }> };
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
    // An RSVP is the most honest thing a member ever says about what they
    // are interested in (RDR-01).
    private readonly radar: RadarService,
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
      include: { room: true, publishedEvent: { select: { id: true } }, event: { select: { id: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.userId !== userId && !isStaff) {
      throw new ForbiddenException('That booking is not yours');
    }
    // Either link counts: the old one-to-one and the new `eventId` (SPC-26)
    // both mean this room is already held for something the co-op can see.
    if (booking.publishedEvent || booking.event) {
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

    // Everything the booking already answered carries across (EVT-17). The
    // member said who it is open to, roughly how many people, whether it
    // costs, and what kind of gathering when they booked the room (SPC-21) —
    // asking again is a step backwards, and the two answers drifting apart is
    // worse than either.
    return this.create(
      orgId,
      {
        title: dto.title ?? booking.title,
        description: dto.description ?? booking.description ?? undefined,
        startTime: booking.startTime.toISOString(),
        endTime: booking.endTime.toISOString(),
        roomId: booking.roomId,
        visibility: dto.visibility ?? booking.visibility,
        // The member's own estimate before the room's capacity: they know who
        // they invited, and the room's number is an upper bound rather than a
        // guess at attendance.
        capacity:
          dto.capacity ?? booking.expectedAttendance ?? booking.room.capacity ?? undefined,
        category: dto.category ?? booking.categories[0],
        tags: booking.categories,
        imageUrl: dto.imageUrl,
        imageCredit: dto.imageCredit,
        imageCreditUrl: dto.imageCreditUrl,
      } as CreateEventDto,
      userId,
      {
        bookingId: booking.id,
        publish: dto.publish ?? true,
        hasCost: booking.hasCost,
        // Carried like every other booking answer (EVT-17): a 21+ booking
        // published to the public must not arrive there saying nothing.
        maturityLevel: booking.maturityLevel,
      },
    );
  }

  async create(
    orgId: string,
    dto: CreateEventDto,
    userId: string,
    options: {
      bookingId?: string;
      publish?: boolean;
      hasCost?: boolean;
      maturityLevel?: CreateEventDto['maturityLevel'];
    } = {},
  ) {
    const slug = toSlug(dto.title, dto.startTime);

    // Ensure slug uniqueness within the org
    const existing = await this.prisma.event.findUnique({
      where: { orgId_slug: { orgId, slug } },
    });

    const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

    const created = await this.prisma.event.create({
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
        // Who made it, kept apart from who runs it (EVT-32). An organiser
        // creating an event on a member's behalf sets `hostId` to them and
        // would otherwise have no claim on it afterwards.
        createdById: userId,
        bookingId: options.bookingId,
        // The same reservation in the shape that can hold more than one
        // (SPC-26): an event's rooms are the bookings pointing at it.
        ...(options.bookingId
          ? { rooms: { connect: { id: options.bookingId } } }
          : {}),
        ...(dto.bookingIds?.length
          ? { rooms: { connect: dto.bookingIds.map((id) => ({ id })) } }
          : {}),
        // A member publishing their own event means it goes live. Leaving it
        // as a draft they cannot publish would be a dead end — the point of
        // the feature is that they can share it.
        ...(options.publish ?? dto.publish
          ? { isPublished: true, publishedAt: new Date() }
          : {}),
        waitlistEnabled: dto.waitlistEnabled,
        category: dto.category,
        tags: dto.tags,
        hasCost: options.hasCost ?? dto.hasCost ?? false,
        // What they suggest at the door (EVT-34). Only meaningful alongside
        // `hasCost`, and optional even then.
        suggestedCents: dto.suggestedCents ?? null,
        // Everybody else running it, named on the same form (EVT-36).
        ...(dto.coHostIds?.length
          ? {
              coHosts: {
                create: [...new Set(dto.coHostIds)]
                  .filter((id) => id !== (dto.hostId ?? userId))
                  .map((id) => ({ userId: id, addedById: userId })),
              },
            }
          : {}),
        maturityLevel: options.maturityLevel ?? dto.maturityLevel ?? 'ALL_AGES',
        // The picture, and whoever has to be credited for it (EVT-22). Empty
        // string means "none" — that is what a cleared field sends — and is
        // stored as null so the column has one way of saying nothing.
        imageUrl: dto.imageUrl?.trim() || null,
        imageCredit: dto.imageCredit?.trim() || null,
        imageCreditUrl: dto.imageCreditUrl?.trim() || null,
      },
    });

    /*
      Created already published, with no room, where the co-op asks for one
      (SPC-27).

      Checked after the write rather than before: the rooms are connected in
      the same statement, so there is nothing to count until it exists. The
      event is unpublished again rather than deleted — somebody wrote it, and
      throwing away their description to enforce a setting is a worse answer
      than handing it back as a draft.
    */
    if (created.isPublished) {
      try {
        await this.requireRoomIfEnforced(orgId, created.id);
      } catch (error) {
        await this.prisma.event.update({
          where: { id: created.id },
          data: { isPublished: false, publishedAt: null },
        });
        throw error;
      }
    }

    return created;
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
  /**
   * The event, if this person may change it (EVT-33).
   *
   * An organiser, the host, whoever created it, or a co-host. This read only
   * `hostId`, so an organiser creating an event for a member lost the ability
   * to correct it the moment they set the host, and a co-host — somebody
   * asked to help run the evening — could change nothing at all.
   */
  private async loadEventForActor(
    orgId: string,
    eventId: string,
    userId: string,
    isStaff: boolean,
  ) {
    const event = await this.findEventInOrg(orgId, eventId);

    // An organiser may act on any event in their co-op, so the co-host list
    // cannot change the answer and is not worth a query.
    if (isStaff) return event;

    const coHosts = await this.prisma.eventCoHost.findMany({
      where: { eventId },
      select: { userId: true },
    });

    const allowed = canEditEvent(
      {
        hostId: event.hostId,
        createdById: (event as { createdById?: string | null }).createdById ?? null,
        coHostIds: coHosts.map((c) => c.userId),
      },
      userId,
      isStaff,
    );
    if (!allowed) throw new ForbiddenException(NOT_YOUR_EVENT);

    return event;
  }

  // ─── Tickets and the waitlist, for whoever runs the event (EVT-41) ──

  /**
   * Stop or restart selling.
   *
   * Charley: "add an option to pause ticket sales." Distinct from the two
   * things that already existed and are not this: unpublishing hides the
   * event from everybody, and cancelling refunds the room. A pause holds the
   * last few places back while the event stays where it is and the people
   * already coming stay coming.
   */
  async setTicketSales(
    orgId: string,
    eventId: string,
    userId: string,
    isStaff: boolean,
    paused: boolean,
  ) {
    await this.loadEventForActor(orgId, eventId, userId, isStaff);

    return this.prisma.event.update({
      where: { id: eventId },
      data: { ticketSalesPaused: paused },
      select: { id: true, ticketSalesPaused: true },
    });
  }

  /**
   * Who is waiting, in the order they asked (EVT-41).
   *
   * Charley: "where do hosts see and manage the waitlist if there is one?"
   * Nowhere, was the answer. The engine has worked since EventOS was built —
   * over capacity a guest is WAITLISTED, and a cancellation promotes the
   * first of them automatically and emails them — but no screen in the
   * product listed those people, so a host could not tell whether three were
   * waiting or thirty, nor let a particular one in.
   *
   * Ordered by when they joined it, because that order is the promise the
   * automatic promotion already keeps.
   */
  async listWaitlist(orgId: string, eventId: string, userId: string, isStaff: boolean) {
    const event = await this.loadEventForActor(orgId, eventId, userId, isStaff);

    const waiting = await this.prisma.rsvp.findMany({
      where: { eventId, status: 'WAITLISTED' },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });

    const confirmed = await this.prisma.rsvp.count({
      where: { eventId, status: 'CONFIRMED' },
    });

    return {
      capacity: event.capacity,
      confirmed,
      /** Places free right now; null when the event has no capacity set. */
      spareSeats: event.capacity === null ? null : Math.max(0, event.capacity - confirmed),
      waiting: waiting.map((r, index) => ({
        rsvpId: r.id,
        position: index + 1,
        userId: r.userId,
        name: r.user?.name ?? null,
        avatarUrl: r.user?.avatarUrl ?? null,
        plusOnes: r.plusOnes,
        joinedAt: r.createdAt,
      })),
    };
  }

  /**
   * Let one particular person in, out of turn if the host chooses.
   *
   * The automatic promotion is first-come; this is the host overriding it,
   * which is the thing they could not do. It deliberately does **not** check
   * capacity: a host letting somebody in off the waitlist has decided there
   * is room, and refusing them on a number the host can see and the code
   * cannot interpret is how a feature becomes something people work around.
   */
  async promoteFromWaitlist(
    orgId: string,
    eventId: string,
    rsvpId: string,
    userId: string,
    isStaff: boolean,
  ) {
    await this.loadEventForActor(orgId, eventId, userId, isStaff);

    // Scoped to the event, not taken on trust from the URL (SEC-04).
    const rsvp = await this.prisma.rsvp.findFirst({
      where: { id: rsvpId, eventId, status: 'WAITLISTED' },
    });
    if (!rsvp) throw new NotFoundException('Nobody on the waitlist by that id');

    await this.prisma.rsvp.update({
      where: { id: rsvp.id },
      data: { status: 'CONFIRMED' },
    });

    // The same email the automatic promotion sends, for the same reason: the
    // person waiting is the one who needs to know.
    await this.notifyPromoted(orgId, rsvp.id);

    return { promoted: true, rsvpId: rsvp.id };
  }

  async update(
    orgId: string,
    eventId: string,
    dto: UpdateEventDto,
    actor: { userId: string; isStaff: boolean },
  ) {
    const event = await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    /*
      Who runs it is a narrower question than what it says (EVT-32, EVT-33).

      Everybody who may edit may set the title, the picture, the times, who
      can see it and what a ticket costs. Handing the event to somebody else
      is decided by the organiser, the host or the creator — not by a
      co-host, who was asked to help run an evening rather than given the
      power to pass it on. `PATCH /host` is the route for it, and this field
      defers to the same rule.
    */
    if (
      dto.hostId !== undefined &&
      !canManageHosts(
        {
          hostId: event.hostId,
          createdById: (event as { createdById?: string | null }).createdById ?? null,
        },
        actor.userId,
        actor.isStaff,
      )
    ) {
      throw new ForbiddenException(NOT_YOURS);
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

    const updated = await this.prisma.event.update({
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
        ...(dto.hasCost !== undefined && { hasCost: dto.hasCost }),
        ...(dto.suggestedCents !== undefined && { suggestedCents: dto.suggestedCents || null }),
        ...(dto.maturityLevel !== undefined && { maturityLevel: dto.maturityLevel }),
        // Blank clears it, so removing a picture is a save rather than a
        // separate delete — and the credit goes with it, because a credit
        // with no photograph is a stray line under nothing (EVT-22).
        // `?.` rather than `.`: `@IsOptional()` lets an explicit null through,
        // and the edit form sends one for a field it is clearing. `null.trim()`
        // is a 500 on a save that should simply have removed the picture.
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl?.trim() || null }),
        ...(dto.imageCredit !== undefined && { imageCredit: dto.imageCredit?.trim() || null }),
        ...(dto.imageCreditUrl !== undefined && {
          imageCreditUrl: dto.imageCreditUrl?.trim() || null,
        }),
        ...(slug && { slug }),
      },
    });

    /*
      The co-host list, where the form sent one (EVT-36).

      After the event is written, so a rejected update does not leave the
      co-hosts changed — and guarded by `canManageHosts` rather than the
      edit rule, because a co-host may change everything about an event
      except who runs it.
    */
    if (dto.coHostIds !== undefined) {
      if (
        !canManageHosts(
          {
            hostId: dto.hostId ?? event.hostId,
            createdById: (event as { createdById?: string | null }).createdById ?? null,
          },
          actor.userId,
          actor.isStaff,
        )
      ) {
        throw new ForbiddenException(NOT_YOURS);
      }

      await this.setCoHosts(
        orgId,
        eventId,
        dto.hostId ?? event.hostId,
        dto.coHostIds,
        actor.userId,
      );
    }

    // The rooms, after the co-hosts: whose reservations count depends on who
    // is running it, and the form can change both in one save (SPC-27).
    if (dto.bookingIds !== undefined) {
      await this.setRooms(orgId, eventId, dto.bookingIds, {
        userId: actor.userId,
        isOrganiser: actor.isStaff,
      });
    }

    return updated;
  }

  /* ─── Publish ───────────────────────────────────────────────── */

  async publish(
    orgId: string,
    eventId: string,
    actor: { userId: string; isStaff: boolean },
  ) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);
    // Where the co-op asks every event to name a room (SPC-27).
    await this.requireRoomIfEnforced(orgId, eventId);

    const published = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
    });

    return published;
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
        // Everyone else running it (EVT-32).
        coHosts: {
          select: {
            userId: true,
            user: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        // Every room this event occupies (SPC-26). A list, because an evening
        // using the Attic and the Salon is two reservations.
        rooms: {
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            room: { select: { id: true, name: true } },
          },
          orderBy: { startTime: 'asc' },
        },
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
          /*
            Everybody running it, the rooms it holds, and how many tickets
            have gone (EVT-35, SPC-26).

            EVT-35 shipped the card that reads these and not the query that
            fetches them, so every card said "No host set" and no ticket line
            ever appeared. The web tests read the web source and passed; what
            would have caught it is a test on the shape this returns.
          */
          coHosts: {
            select: { userId: true, user: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          rooms: {
            select: {
              id: true,
              startTime: true,
              endTime: true,
              status: true,
              room: { select: { id: true, name: true } },
            },
            orderBy: { startTime: 'asc' },
          },
          _count: { select: { tickets: { where: { refundedAt: null } } } },
          ...CONFIRMED_RSVP_COUNT,
          ...RSVP_FACES,
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: data.map((event) => {
        const row = withRsvpFaces(withRsvpCount(event)) as Record<string, unknown> & {
          _count?: { tickets?: number };
        };
        // Flattened: `_count` also carries the RSVP count, and the shape a
        // card reads should not depend on which query built it (EVT-35).
        const { _count, ...rest } = row;
        return { ...rest, ticketsSold: _count?.tickets ?? 0 };
      }),
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
  /** How far ahead a website embed looks. See `listEmbedEvents` (EVT-21). */
  private static readonly EMBED_WINDOW_DAYS = 30;

  async listEmbedEvents(orgSlug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, name: true, slug: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    // The next 30 days, all of them (EVT-21). Charley: "always shows the next
    // 30 days of events without needing pagination." A window rather than a
    // count, because a co-op with a busy fortnight and a quiet one should not
    // see the busy fortnight truncated — and because a page of embedded events
    // with a "next" button on somebody's marketing site is a dead end.
    const now = new Date();
    const horizon = new Date(now.getTime() + EventsService.EMBED_WINDOW_DAYS * 86_400_000);

    const { data } = await this.listPublicEvents(org.id, {
      from: now.toISOString(),
      to: horizon.toISOString(),
      // High enough that the window is what limits the list, not the page
      // size. A co-op with more than 200 public events in 30 days has a
      // different problem.
      perPage: 200,
    });

    return {
      org: { name: org.name, slug: org.slug },
      windowDays: EventsService.EMBED_WINDOW_DAYS,
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
  /*
    There is no announcement any more (EVT-42).

    EVT-23 put every published event into #Events, because an event Charley
    had just made did not appear there and most of what a co-op wants from the
    Commons is to hear that things exist. The cost was stated at the time and
    accepted: "the empty-thread cost is real".

    It turned out to be the whole cost. Of the seven event threads MaybeItsFate
    had, six carried no comments, and the channel read as a list of messages
    nobody had written. A thread in #Events now means a conversation is
    happening — it is created by the first comment and by nothing else.

    If announcing comes back, it should be an announcement and not an empty
    discussion thread wearing one's clothes.
  */

  /**
   * The post carrying this event's comments, if one exists (EVT-42).
   *
   * Separate from `ensureEventThread` because reading and creating were the
   * same call, and the page called it on load. Opening an event therefore
   * posted to #Events under the name of whoever opened it: three appeared in
   * one browsing session five days after those events were published, with no
   * comments on any of them, looking for all the world like a member had
   * written something.
   */
  async eventThread(orgId: string, eventId: string): Promise<{ postId: string | null }> {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: { postId: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    return { postId: event.postId };
  }

  async ensureEventThread(orgId: string, eventId: string, authorId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        title: true,
        slug: true,
        postId: true,
        visibility: true,
        org: { select: { slug: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (event.postId) return { postId: event.postId };

    /*
      Never a private one (EVT-42).

      Announcing already refused these — "#Events is read by every member of
      the co-op, and posting one there would be the product overriding a
      member's own answer about who can see it" — but this path had no such
      check, and it was the path that ran when anybody opened the page. One
      private event and its title would have been in the channel the whole
      co-op reads. There were none, so it never happened.
    */
    if (event.visibility === 'PRIVATE') return { postId: null };

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
        // Deliberately thin, and now with a way to reach the event. The event
        // page is where the detail lives — a copy here would be a second
        // version of the truth to keep in step — but a thread announcing
        // something people cannot click through to is a poor announcement.
        //
        // Escaped, because a title is written by a member and this body is
        // stored and rendered as HTML.
        body:
          `<p>Discussion for <a href="/portal/${event.org.slug}/events/${event.slug}">` +
          `${escapeHtml(event.title)}</a>.</p>`,
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

    // Two shapes, because there are two audiences (SEC-12). A member is inside
    // the tenant and gets the row; the open internet gets the chosen columns,
    // which is what keeps a room's Google tokens off a public list. Faces
    // likewise: an event link may be public so strangers can RSVP, but who is
    // attending is not — a guest list on a public page tells anyone with the
    // URL who belongs to this co-op.
    //
    // An interactive transaction rather than the array form: the two branches
    // return different shapes, which the array form cannot type, and the count
    // still has to be taken against the same snapshot as the page.
    const [data, total] = await this.prisma.$transaction(async (tx) => {
      const rows = viewerIsMember
        ? await tx.event.findMany({
            where,
            orderBy: { startTime: 'asc' },
            skip,
            take: perPage,
            include: {
              location: true,
              room: true,
              ...CONFIRMED_RSVP_COUNT,
              ...RSVP_FACES,
            },
          })
        : await tx.event.findMany({
            where,
            orderBy: { startTime: 'asc' },
            skip,
            take: perPage,
            select: PUBLIC_EVENT_SELECT,
          });
      const count = await tx.event.count({ where });
      return [rows, count] as const;
    });

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
      // No host here, deliberately. Who runs an event is half of why somebody
      // comes, but this endpoint answers to the open internet and an admin
      // ticking "public" agreed to publish the event, not to publish a
      // member's name. Signed-in members read the host from the org-scoped
      // endpoint instead.
      //
      // That was the intent and `include` did not carry it out: the host's
      // *name* was withheld while `hostId` went out in the row, along with
      // every column of the room — `googleTokens` included (SEC-12).
      select: {
        ...PUBLIC_EVENT_SELECT,
        org: { select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true } },
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
        const revived = await this.prisma.rsvp.update({
          where: { id: existing.id },
          data: {
            status,
            plusOnes: dto.plusOnes ?? 0,
            note: dto.note,
            checkedIn: false,
            checkedInAt: null,
          },
        });
        await this.radar.recordRsvp(orgId, eventId, userId);
        return revived;
      }
    }

    const status = this.determineRsvpStatus(event);

    const created = await this.prisma.rsvp.create({
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

    // Members only: a guest RSVP has no membership to learn against, and an
    // email address is not somebody MaybeOS gets to form opinions about.
    // Never allowed to fail the RSVP — see `RadarService.recordRsvp`.
    if (userId) await this.radar.recordRsvp(orgId, eventId, userId);

    return created;
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
      where: {
        orgId,
        OR: [{ hostId: userId }, { coHosts: { some: { userId } } }],
      },
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

  /**
   * Repeat an event, and hold its rooms for each one (EVT-37).
   *
   * Materialised: every occurrence is its own event, with the first as its
   * parent. An event carries RSVPs, tickets, a picture and a room — a rule
   * cannot hold any of those, and a room either is or is not free on the
   * 14th.
   *
   * **Rooms are the hard part, and the reason this is not a calendar's
   * repeat.** A room is exclusive. Each date is checked against what the
   * building already has, and a clash is reported rather than booked: an
   * organiser needs to know the 14th is taken now, not in November. The event
   * is still made for that date — somebody can move the room or hold it
   * elsewhere — and the reply says which ones have no room.
   *
   * `dryRun` first, like every other bulk thing here.
   */
  async repeat(
    orgId: string,
    eventId: string,
    dto: RepeatEventDto,
    actor: { userId: string; isStaff: boolean },
  ) {
    const source = await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    const timeZone = org?.timezone ?? 'America/New_York';

    // Through its org, not by bare id: the caller writes the URL, so being a
    // member of the org they named proves nothing about this event.
    const full = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        coHosts: { select: { userId: true } },
        rooms: { select: { id: true, roomId: true, startTime: true, endTime: true } },
      },
    });
    if (!full) throw new NotFoundException('Event not found');

    const starts = occurrencesOf(
      full.startTime,
      {
        frequency: dto.frequency,
        interval: dto.interval,
        weekdays: dto.weekdays,
        count: dto.count,
        until: dto.until ? new Date(dto.until) : undefined,
      },
      timeZone,
    );

    // The first is the event that already exists.
    const rest = starts.slice(1);
    const lengthMs = full.endTime.getTime() - full.startTime.getTime();
    const wantRooms = dto.withRooms !== false && full.rooms.length > 0;

    const planned: Array<{
      startTime: Date;
      endTime: Date;
      rooms: Array<{ roomId: string; startTime: Date; endTime: Date; free: boolean }>;
    }> = [];

    for (const start of rest) {
      const end = new Date(start.getTime() + lengthMs);
      const rooms: Array<{ roomId: string; startTime: Date; endTime: Date; free: boolean }> = [];

      if (wantRooms) {
        for (const held of full.rooms) {
          // Each room keeps its own offset from the event's start, so a
          // set-up booking that begins an hour early stays an hour early.
          const offset = held.startTime.getTime() - full.startTime.getTime();
          const roomStart = new Date(start.getTime() + offset);
          const roomEnd = new Date(
            roomStart.getTime() + (held.endTime.getTime() - held.startTime.getTime()),
          );
          /*
            Is the room free then?

            The same question `SpaceService.checkConflicts` answers, asked
            here rather than through it: importing the space module into
            events for one query would tie two large modules together, and
            the rule is three lines — anything approved, pending, or holding
            a paid slot that has not expired, overlapping this window.
          */
          const clash = await this.prisma.booking.findFirst({
            where: {
              roomId: held.roomId,
              OR: [
                { status: { in: ['APPROVED', 'PENDING'] } },
                { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } },
              ],
              startTime: { lt: roomEnd },
              endTime: { gt: roomStart },
            },
            select: { id: true },
          });
          rooms.push({ roomId: held.roomId, startTime: roomStart, endTime: roomEnd, free: !clash });
        }
      }

      planned.push({ startTime: start, endTime: end, rooms });
    }

    const clashes = planned.filter((p) => p.rooms.some((r) => !r.free)).length;

    if (dto.dryRun !== false) {
      // Whether a year was asked for or simply reached (EVT-38). Worth saying:
      // somebody who asked for two years should be told they got one.
      const horizon = horizonFrom(full.startTime);
      const clamped =
        Boolean(dto.until && new Date(dto.until).getTime() > horizon.getTime()) ||
        (planned.length > 0 &&
          !dto.until &&
          !dto.count &&
          planned[planned.length - 1].startTime.getTime() >
            horizon.getTime() - 366 * 86_400_000);

      return {
        dryRun: true,
        occurrences: planned.length,
        firstOn: planned[0]?.startTime ?? null,
        lastOn: planned[planned.length - 1]?.startTime ?? null,
        roomClashes: clashes,
        /** True when a year is as far as this reaches (EVT-38). */
        stopsAtAYear: clamped,
        summary: describeRecurrence(
          { frequency: dto.frequency, interval: dto.interval, weekdays: dto.weekdays },
          planned.length + 1,
        ),
      };
    }

    /*
      Written in pieces (EVT-38).

      A year of a daily event is 366 events and as many reservations, which
      does not fit in a Lambda's ten seconds. The reply says where it stopped
      and the client asks again — the shape the calendar import arrived at
      the expensive way (CAL-05).

      Resumable by index rather than by cursor, because the occurrences are
      derived from the rule: asking again with the same rule produces the
      same dates in the same order.
    */
    const startAt = Math.max(0, Math.floor(dto.fromIndex ?? 0));
    const deadline = Date.now() + 6_000;

    let made = 0;
    let roomsHeld = 0;
    let nextIndex: number | null = null;

    for (const [index, occurrence] of planned.entries()) {
      if (index < startAt) continue;
      if (Date.now() >= deadline) {
        nextIndex = index;
        break;
      }
      const created = await this.prisma.event.create({
        data: {
          orgId,
          parentEventId: full.parentEventId ?? full.id,
          title: full.title,
          slug: await this.slugForRepeat(orgId, full.slug, occurrence.startTime),
          description: full.description,
          startTime: occurrence.startTime,
          endTime: occurrence.endTime,
          timezone: full.timezone,
          visibility: full.visibility,
          category: full.category,
          tags: full.tags,
          capacity: full.capacity,
          waitlistEnabled: full.waitlistEnabled,
          hostId: full.hostId,
          createdById: actor.userId,
          hasCost: full.hasCost,
          suggestedCents: full.suggestedCents,
          priceCents: full.priceCents,
          currency: full.currency,
          maturityLevel: full.maturityLevel,
          locationId: full.locationId,
          roomId: full.roomId,
          imageUrl: full.imageUrl,
          imageCredit: full.imageCredit,
          imageCreditUrl: full.imageCreditUrl,
          // Drafts, every one. A series going live the moment it is made
          // would announce fifty-two evenings into the Commons at once
          // (EVT-23), and an organiser wants to look at the dates first.
          isPublished: false,
          coHosts: {
            create: full.coHosts.map((c) => ({ userId: c.userId, addedById: actor.userId })),
          },
        },
        select: { id: true },
      });
      made += 1;

      for (const room of occurrence.rooms) {
        if (!room.free) continue;
        await this.prisma.booking.create({
          data: {
            roomId: room.roomId,
            userId: full.hostId ?? actor.userId,
            eventId: created.id,
            title: full.title,
            startTime: room.startTime,
            endTime: room.endTime,
            status: 'APPROVED',
            visibility: 'PRIVATE',
          },
        });
        roomsHeld += 1;
      }
    }

    return {
      dryRun: false,
      occurrences: made,
      roomsHeld,
      roomClashes: clashes,
      firstOn: planned[0]?.startTime ?? null,
      lastOn: planned[planned.length - 1]?.startTime ?? null,
      /** Where to carry on, or null when the series is complete (EVT-38). */
      next: nextIndex,
      total: planned.length,
    };
  }

  /**
   * Copy an event to a new date (EVT-38).
   *
   * Distinct from repeating it. A repeat is a rule; a clone is "do that
   * again", and what gets cloned is usually a one-off — last year's
   * fundraiser, the workshop that went well.
   *
   * **The series question is asked, never assumed.** A member looking at one
   * Tuesday of a weekly class cannot tell from the screen whether "clone"
   * means that Tuesday or all fifty-two, and guessing either way is wrong
   * half the time. Where the event has a series, a scope is required, and
   * choosing the series has to be said twice.
   *
   * A cloned series keeps its spacing: the whole run is shifted so the first
   * one lands on the chosen date, which is what "another year of this" means.
   */
  async clone(
    orgId: string,
    eventId: string,
    dto: CloneEventDto,
    actor: { userId: string; isStaff: boolean },
  ) {
    await this.loadEventForActor(orgId, eventId, actor.userId, actor.isStaff);

    const source = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        coHosts: { select: { userId: true } },
        rooms: { select: { id: true, roomId: true, startTime: true, endTime: true } },
      },
    });
    if (!source) throw new NotFoundException('Event not found');

    // Everything in the same run, in order. The event itself counts.
    const seriesId = source.parentEventId ?? source.id;
    const series = await this.prisma.event.findMany({
      where: { orgId, OR: [{ id: seriesId }, { parentEventId: seriesId }] },
      orderBy: { startTime: 'asc' },
      include: {
        coHosts: { select: { userId: true } },
        rooms: { select: { id: true, roomId: true, startTime: true, endTime: true } },
      },
    });
    const hasSeries = series.length > 1;

    if (hasSeries && !dto.scope) {
      throw new BadRequestException(
        `This event is one of ${series.length} in a series. Say whether to copy just this one or all ${series.length}.`,
      );
    }
    if (dto.scope === 'series' && !dto.confirmSeries) {
      throw new BadRequestException(
        `Copying the whole series makes ${series.length} more events. Confirm that is what you want.`,
      );
    }

    const copying = dto.scope === 'series' && hasSeries ? series : [source];
    const shift = new Date(dto.startTime).getTime() - copying[0].startTime.getTime();

    // The clone of a series is a series too, and it is capped the same way:
    // a year from where the copy starts (EVT-38).
    const horizon = horizonFrom(new Date(dto.startTime));
    const planned = copying
      .map((one) => ({
        source: one,
        startTime: new Date(one.startTime.getTime() + shift),
        endTime: new Date(one.endTime.getTime() + shift),
      }))
      .filter((one) => one.startTime.getTime() <= horizon.getTime());

    const dropped = copying.length - planned.length;

    if (dto.dryRun !== false) {
      return {
        dryRun: true,
        copies: planned.length,
        hasSeries,
        seriesLength: series.length,
        firstOn: planned[0]?.startTime ?? null,
        lastOn: planned[planned.length - 1]?.startTime ?? null,
        /** Occurrences past a year from the new start, which are not copied. */
        droppedPastAYear: dropped,
      };
    }

    const newParent = planned.length > 1 ? null : undefined;
    let made = 0;
    let roomsHeld = 0;
    let parentId: string | null = null;

    for (const one of planned) {
      const created = await this.prisma.event.create({
        data: {
          orgId,
          // The first copy is the parent of the rest, so a cloned series is
          // its own run rather than more children of the original.
          parentEventId: parentId ?? newParent ?? null,
          title: one.source.title,
          slug: await this.slugForRepeat(orgId, one.source.slug, one.startTime),
          description: one.source.description,
          startTime: one.startTime,
          endTime: one.endTime,
          timezone: one.source.timezone,
          visibility: one.source.visibility,
          category: one.source.category,
          tags: one.source.tags,
          capacity: one.source.capacity,
          waitlistEnabled: one.source.waitlistEnabled,
          hostId: one.source.hostId,
          createdById: actor.userId,
          hasCost: one.source.hasCost,
          suggestedCents: one.source.suggestedCents,
          priceCents: one.source.priceCents,
          currency: one.source.currency,
          maturityLevel: one.source.maturityLevel,
          locationId: one.source.locationId,
          roomId: one.source.roomId,
          imageUrl: one.source.imageUrl,
          imageCredit: one.source.imageCredit,
          imageCreditUrl: one.source.imageCreditUrl,
          // A draft. Nothing is copied into the Commons (EVT-23), and the
          // RSVPs and tickets of the original are its own.
          isPublished: false,
          coHosts: {
            create: one.source.coHosts.map((c) => ({ userId: c.userId, addedById: actor.userId })),
          },
        },
        select: { id: true },
      });
      if (!parentId) parentId = created.id;
      made += 1;

      if (dto.withRooms !== false) {
        for (const held of one.source.rooms) {
          const roomStart = new Date(held.startTime.getTime() + shift);
          const roomEnd = new Date(held.endTime.getTime() + shift);
          const clash = await this.prisma.booking.findFirst({
            where: {
              roomId: held.roomId,
              OR: [
                { status: { in: ['APPROVED', 'PENDING'] } },
                { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } },
              ],
              startTime: { lt: roomEnd },
              endTime: { gt: roomStart },
            },
            select: { id: true },
          });
          if (clash) continue;

          await this.prisma.booking.create({
            data: {
              roomId: held.roomId,
              userId: one.source.hostId ?? actor.userId,
              eventId: created.id,
              title: one.source.title,
              startTime: roomStart,
              endTime: roomEnd,
              status: 'APPROVED',
              visibility: 'PRIVATE',
            },
          });
          roomsHeld += 1;
        }
      }
    }

    return {
      dryRun: false,
      copies: made,
      roomsHeld,
      hasSeries,
      seriesLength: series.length,
      droppedPastAYear: dropped,
      firstOn: planned[0]?.startTime ?? null,
      lastOn: planned[planned.length - 1]?.startTime ?? null,
    };
  }

  /** A readable, free address for one occurrence of a repeat (EVT-37). */
  private async slugForRepeat(orgId: string, base: string, start: Date): Promise<string> {
    const day = start.toISOString().slice(0, 10);
    const stem = base.replace(/-\d{4}-\d{2}-\d{2}(-\d+)?$/, '');
    const candidates = [`${stem}-${day}`, ...Array.from({ length: 20 }, (_, i) => `${stem}-${day}-${i + 2}`)];

    const taken = await this.prisma.event.findMany({
      where: { orgId, slug: { in: candidates } },
      select: { slug: true },
    });
    const used = new Set(taken.map((t) => t.slug));

    return candidates.find((c) => !used.has(c)) ?? `${stem}-${start.getTime()}`;
  }

  /**
   * Reservations this event could claim (SPC-27).
   *
   * The host's and their co-hosts' holds on rooms, not yet attached to
   * anything, near the event's own date — a member searching for "the Attic
   * on Thursday" is looking at a handful of rows, not their booking history.
   *
   * Organisers see the co-op's, because sorting out a double-booked evening
   * is their job.
   */
  async attachableRooms(
    orgId: string,
    actor: { userId: string; isOrganiser: boolean },
    options: { eventId?: string; from?: string; to?: string } = {},
  ) {
    const event = options.eventId
      ? await this.prisma.event.findFirst({
          where: { id: options.eventId, orgId },
          select: {
            hostId: true,
            createdById: true,
            startTime: true,
            coHosts: { select: { userId: true } },
          },
        })
      : null;

    const who = whoseRoomsCount(actor, {
      hostId: event?.hostId ?? actor.userId,
      createdById: event?.createdById ?? actor.userId,
      coHostIds: event?.coHosts.map((c) => c.userId) ?? [],
    });

    // A fortnight either side of the event, or of today when there is no
    // event yet. Wide enough for "I booked it last week", narrow enough that
    // a member who books the Attic weekly is not scrolling a year.
    const around = event?.startTime ?? (options.from ? new Date(options.from) : new Date());
    const from = options.from ? new Date(options.from) : new Date(around.getTime() - 14 * 86_400_000);
    const to = options.to ? new Date(options.to) : new Date(around.getTime() + 14 * 86_400_000);

    return this.prisma.booking.findMany({
      where: {
        room: { orgId },
        isCoopHold: false,
        status: { in: ['PENDING', 'APPROVED'] },
        // Free, or already this event's — so an event's own rooms stay in the
        // list it is choosing from.
        OR: [{ eventId: null }, ...(options.eventId ? [{ eventId: options.eventId }] : [])],
        ...(who.anyone ? {} : { userId: { in: who.userIds } }),
        startTime: { gte: from, lte: to },
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        status: true,
        eventId: true,
        room: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      take: 50,
    });
  }

  /**
   * Make the event's rooms match what was sent (SPC-27).
   *
   * The whole list, like the co-hosts and for the same reason: the form
   * holds them alongside the title, so cancelling leaves the event alone.
   *
   * A reservation it may not have — somebody else's, one already held for
   * another event, a hold the co-op made — stops the save with a sentence
   * rather than being dropped quietly. Taking a room by accident is the one
   * outcome worth refusing the whole request over.
   */
  private async setRooms(
    orgId: string,
    eventId: string,
    wanted: string[],
    actor: { userId: string; isOrganiser: boolean },
  ) {
    const unique = [...new Set(wanted)];

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: { hostId: true, createdById: true, coHosts: { select: { userId: true } } },
    });
    if (!event) throw new NotFoundException('Event not found');

    const who = whoseRoomsCount(actor, {
      hostId: event.hostId,
      createdById: event.createdById,
      coHostIds: event.coHosts.map((c) => c.userId),
    });

    const bookings = unique.length
      ? await this.prisma.booking.findMany({
          where: { id: { in: unique }, room: { orgId } },
          select: { id: true, eventId: true, isCoopHold: true, status: true, userId: true },
        })
      : [];

    if (bookings.length !== unique.length) {
      throw new BadRequestException('One of those reservations is not in this co-op.');
    }

    for (const booking of bookings) {
      const problem = attachProblem(booking, eventId, who);
      if (problem) throw new BadRequestException(problem);
    }

    await this.prisma.$transaction([
      // Released rather than deleted: the member still holds the room, it is
      // simply not this event's any more.
      this.prisma.booking.updateMany({
        where: { eventId, id: { notIn: unique.length ? unique : ['-'] } },
        data: { eventId: null },
      }),
      ...(unique.length
        ? [
            this.prisma.booking.updateMany({
              where: { id: { in: unique } },
              data: { eventId },
            }),
          ]
        : []),
    ]);
  }

  /**
   * Refuse to publish an event with no room, where the co-op asks for one
   * (SPC-27).
   *
   * At publishing rather than at creation. A draft with no room yet is an
   * ordinary half-finished thing; an event the whole co-op can see, with no
   * record of where it is, is what the setting exists to prevent.
   */
  private async requireRoomIfEnforced(orgId: string, eventId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { requireEventRoom: true },
    });
    if (!org?.requireEventRoom) return;

    const held = await this.prisma.booking.count({ where: { eventId } });
    if (held === 0) {
      throw new BadRequestException(
        'This co-op asks every event to say which room it is in. Add a room reservation before publishing it — ' +
          'book the room first if there is not one yet.',
      );
    }
  }

  /**
   * Make the co-host list match what was sent (EVT-36).
   *
   * The whole list, not a change to it: the form holds co-hosts alongside the
   * title and sends what it ended up with, so cancelling the form leaves the
   * event alone and saving it twice does nothing the second time.
   *
   * The host is never a co-host of their own event, and nobody who is not a
   * member of this co-op can be either.
   */
  private async setCoHosts(
    orgId: string,
    eventId: string,
    hostId: string | null,
    wanted: string[],
    addedById: string,
  ) {
    const unique = [...new Set(wanted)].filter((id) => id !== hostId);

    const members = unique.length
      ? await this.prisma.userOrg.findMany({
          where: { orgId, userId: { in: unique } },
          select: { userId: true },
        })
      : [];
    const allowed = new Set(members.map((m) => m.userId));

    const missing = unique.filter((id) => !allowed.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(
        `${missing.length === 1 ? 'Somebody' : 'Some of the people'} you added is not a member of this co-op.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.eventCoHost.deleteMany({
        where: { eventId, userId: { notIn: [...allowed] } },
      }),
      ...[...allowed].map((userId) =>
        this.prisma.eventCoHost.upsert({
          where: { eventId_userId: { eventId, userId } },
          create: { eventId, userId, addedById },
          // Already there: leave who added them and when alone.
          update: {},
        }),
      ),
    ]);
  }

  /**
   * Who runs this event (EVT-32).
   *
   * The host and the co-hosts are one concern, so they share one guard: an
   * organiser, the host, or whoever created it. A co-host cannot — being
   * asked to help run an evening is not being given the power to hand it to
   * somebody else.
   */
  private async eventForHostChange(orgId: string, eventId: string, userId: string, isOrganiser: boolean) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        hostId: true,
        createdById: true,
        coHosts: { select: { userId: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    if (!canManageHosts(event, userId, isOrganiser)) {
      throw new ForbiddenException(NOT_YOURS);
    }

    return event;
  }

  /** Nobody can be made to run an event in a co-op they are not in. */
  private async requireMember(orgId: string, userId: string) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { userId: true },
    });
    if (!membership) {
      throw new BadRequestException('That person is not a member of this co-op.');
    }
  }

  /**
   * Hand the event to somebody else (EVT-32).
   *
   * The new host stops being a co-host if they were one, because the list
   * would otherwise read "hosted by Ada, with Ada".
   */
  async setHost(
    orgId: string,
    eventId: string,
    newHostId: string,
    actor: { userId: string; isOrganiser: boolean },
  ) {
    const event = await this.eventForHostChange(orgId, eventId, actor.userId, actor.isOrganiser);
    await this.requireMember(orgId, newHostId);

    await this.prisma.$transaction([
      this.prisma.eventCoHost.deleteMany({ where: { eventId, userId: newHostId } }),
      this.prisma.event.update({ where: { id: eventId }, data: { hostId: newHostId } }),
    ]);

    // Imported events carry a name for a host who is not a member (CAL-03).
    // Naming a real one supersedes it.
    await this.prisma.event.update({
      where: { id: eventId },
      data: { hostEmail: null, hostName: null },
    });

    return { hostId: newHostId, wasCoHost: event.coHosts.some((c) => c.userId === newHostId) };
  }

  /** Somebody else running it alongside the host (EVT-32). */
  async addCoHost(
    orgId: string,
    eventId: string,
    userId: string,
    actor: { userId: string; isOrganiser: boolean },
  ) {
    const event = await this.eventForHostChange(orgId, eventId, actor.userId, actor.isOrganiser);
    await this.requireMember(orgId, userId);

    const problem = coHostProblem(event, userId, event.coHosts.map((c) => c.userId));
    if (problem) throw new BadRequestException(problem);

    await this.prisma.eventCoHost.create({
      data: { eventId, userId, addedById: actor.userId },
    });

    return { added: true };
  }

  /** Take somebody off (EVT-32). Silent when they were not on it. */
  async removeCoHost(
    orgId: string,
    eventId: string,
    userId: string,
    actor: { userId: string; isOrganiser: boolean },
  ) {
    await this.eventForHostChange(orgId, eventId, actor.userId, actor.isOrganiser);

    await this.prisma.eventCoHost.deleteMany({ where: { eventId, userId } });

    return { removed: true };
  }

  /**
   * Take an event off the members' lists without destroying it (EVT-30).
   *
   * The opposite of publishing, and the right answer for most of what an
   * organiser wants gone: a duplicate from an import, something announced
   * early, an event that needs reworking. It keeps its RSVPs, its history and
   * its link, and it stops appearing anywhere members look.
   */
  async unpublish(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: { id: true, isPublished: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    await this.prisma.event.update({
      where: { id: eventId },
      data: { isPublished: false },
    });

    return { hidden: true };
  }

  /**
   * Destroy an event (EVT-30).
   *
   * MaybeItsFate's calendar import brought across duplicates that were
   * duplicated in Google, and there is nothing to keep about those. But a
   * delete is the one action here that cannot be taken back, so it refuses
   * anything somebody is expecting:
   *
   * - a confirmed RSVP means a member has it in their diary;
   * - a ticket means somebody paid.
   *
   * Both want cancelling, which tells those people, rather than deleting,
   * which does not. The refusal says which it is and how many, because
   * "cannot delete" with no number is a dead end.
   */
  async deleteEvent(orgId: string, eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      select: {
        id: true,
        _count: {
          select: {
            rsvps: { where: { status: { in: ['CONFIRMED', 'WAITLISTED'] } } },
            tickets: true,
          },
        },
      },
    });
    if (!event) throw new NotFoundException('Event not found');

    const { rsvps, tickets } = event._count;

    if (tickets > 0) {
      throw new BadRequestException(
        `${tickets} ${tickets === 1 ? 'ticket has' : 'tickets have'} been sold for this event, so it cannot be deleted. ` +
          'Cancel it instead — that tells the people who bought them.',
      );
    }

    if (rsvps > 0) {
      throw new BadRequestException(
        `${rsvps} ${rsvps === 1 ? 'member is' : 'members are'} expecting this event, so it cannot be deleted. ` +
          'Cancel it instead, or hide it if it was never meant to be there.',
      );
    }

    await this.prisma.event.delete({ where: { id: eventId } });

    return { deleted: true };
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
      // The same public columns the other two anonymous routes return
      // (SEC-12): a feed is as public as a page.
      select: PUBLIC_EVENT_SELECT,
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
