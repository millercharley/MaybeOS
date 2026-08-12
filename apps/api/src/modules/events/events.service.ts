import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ContactViewer } from '../../common/access/contact-visibility';
import { CreateEventDto, UpdateEventDto } from './dto/create-event.dto';
import { RsvpDto } from './dto/rsvp.dto';
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

function withRsvpCount<T extends { _count: { rsvps: number } }>(
  event: T,
): Omit<T, '_count'> & { rsvpCount: number } {
  const { _count, ...rest } = event;
  return { ...rest, rsvpCount: _count.rsvps };
}

/* ───────────────────────────── service ───────────────────────────── */

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ─── Create ────────────────────────────────────────────────── */

  async create(orgId: string, dto: CreateEventDto, userId: string) {
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

  async update(orgId: string, eventId: string, dto: UpdateEventDto) {
    const event = await this.findEventInOrg(orgId, eventId);

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
        ...(dto.waitlistEnabled !== undefined && { waitlistEnabled: dto.waitlistEnabled }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.tags !== undefined && { tags: dto.tags }),
        ...(dto.imageUrl !== undefined && { imageUrl: dto.imageUrl }),
        ...(slug && { slug }),
      },
    });
  }

  /* ─── Publish ───────────────────────────────────────────────── */

  async publish(orgId: string, eventId: string) {
    await this.findEventInOrg(orgId, eventId);

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
    });
  }

  /* ─── Cancel ────────────────────────────────────────────────── */

  async cancel(orgId: string, eventId: string) {
    await this.findEventInOrg(orgId, eventId);

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        canceledAt: new Date(),
      },
    });
  }

  /* ─── Find by ID ────────────────────────────────────────────── */

  async findById(orgId: string, eventId: string, viewer: ContactViewer) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, orgId },
      include: {
        rsvps: true,
        room: true,
        location: true,
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
          ...CONFIRMED_RSVP_COUNT,
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: data.map(withRsvpCount),
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    };
  }

  /* ─── List Public Events ────────────────────────────────────── */

  async listPublicEvents(
    orgId: string,
    filters: {
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

    const where: any = {
      orgId,
      visibility: 'PUBLIC',
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
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data: data.map(withRsvpCount),
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
  async listAttendees(orgId: string, eventId: string) {
    await this.findEventInOrg(orgId, eventId);

    const [rsvps, attendance] = await Promise.all([
      this.prisma.rsvp.findMany({
        where: { eventId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
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
  async checkIn(orgId: string, eventId: string, rsvpId: string) {
    await this.findEventInOrg(orgId, eventId);

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
  async undoCheckIn(orgId: string, eventId: string, rsvpId: string) {
    await this.findEventInOrg(orgId, eventId);

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
  async recordWalkIn(orgId: string, eventId: string, name?: string) {
    await this.findEventInOrg(orgId, eventId);

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
}
