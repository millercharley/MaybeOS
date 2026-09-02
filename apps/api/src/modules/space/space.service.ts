import {
  Injectable,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { ContactViewer } from '../../common/access/contact-visibility';
import { EmailService } from '../email/email.service';
import { EventsService } from '../events/events.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AvailabilityRuleDto } from './dto/availability-rule.dto';
import { ClosureDto } from './dto/closure.dto';
import {
  durationsFor,
  hasAnyOpening,
  slotsForDate,
} from './availability/slots';
import { datesInMonth, instantAt, zonedParts } from './availability/zoned-time';
import { ConnectService } from '../stripe/connect.service';
import { CalendarService } from '../calendar/calendar.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class SpaceService {
  private readonly logger = new Logger(SpaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    // A booking can have an event published from it (EVT-05); the two have to
    // stay in step or the co-op advertises a room it no longer holds.
    private readonly eventsService: EventsService,
    // Room hire is charged through the co-op's own connected account (SPC-06),
    // the same path ticket sales take.
    private readonly connect: ConnectService,
    // A booking that never reaches the room's calendar is invisible to
    // everyone not looking at MaybeOS (SPC-04).
    private readonly calendar: CalendarService,
    // Room photos, stored privately and signed on read (SPC-10).
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------------------------------------------ */
  /*  Rooms                                                              */
  /* ------------------------------------------------------------------ */

  async createRoom(orgId: string, dto: CreateRoomDto) {
    return this.prisma.room.create({
      data: {
        orgId,
        name: dto.name,
        description: dto.description,
        capacity: dto.capacity,
        amenities: dto.amenities ?? [],
        locationId: dto.locationId,
        requiresApproval: dto.requiresApproval ?? false,
        memberOnly: dto.memberOnly ?? true,
        // Off unless asked for: a room nobody switched charging on for is free,
        // which is what every existing room expects to stay.
        chargeForBooking: dto.chargeForBooking ?? false,
        alwaysAvailable: dto.alwaysAvailable ?? false,
        hourlyRate: dto.hourlyRate,
        // Null is a real answer here: no cap. `?? null` rather than leaving it
        // out so the column is written deliberately either way.
        maxBookingMinutes: dto.maxBookingMinutes ?? null,
      },
    });
  }

  /**
   * Load a room and confirm it belongs to the org in the URL (SEC-04).
   *
   * SPC-02 fixed this for the booking-cancel path via loadBookingForActor,
   * but left the room and availability paths resolving by bare id. The org
   * guard only proves the caller belongs to the org they named in the URL,
   * so an admin could rename, re-rule or read another co-op's rooms.
   */
  private async findRoomInOrg(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, orgId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    return room;
  }

  private async findBookingInOrg(orgId: string, bookingId: string) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, room: { orgId } },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  async updateRoom(orgId: string, roomId: string, dto: Partial<CreateRoomDto>) {
    await this.findRoomInOrg(orgId, roomId);

    return this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.amenities !== undefined && { amenities: dto.amenities }),
        ...(dto.locationId !== undefined && { locationId: dto.locationId }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.memberOnly !== undefined && { memberOnly: dto.memberOnly }),
        ...(dto.chargeForBooking !== undefined && { chargeForBooking: dto.chargeForBooking }),
        ...(dto.alwaysAvailable !== undefined && { alwaysAvailable: dto.alwaysAvailable }),
        ...(dto.maxBookingMinutes !== undefined && {
          maxBookingMinutes: dto.maxBookingMinutes,
        }),
        ...(dto.hourlyRate !== undefined && { hourlyRate: dto.hourlyRate }),
      },
    });
  }

  /**
   * The rooms a member can book.
   *
   * `googleAccountEmail` is stripped for anyone who is not staff. It is the
   * address of whichever organiser connected the room — often a personal one —
   * and this route is open to every member of the org, so returning it would
   * publish an organiser's email to the whole co-op as a side effect of them
   * setting up a calendar.
   */
  /**
   * Put a photo on a room (SPC-10).
   *
   * Private and signed on read, like article covers and avatars: a room photo
   * shows the inside of a co-op's building, and a co-op that has not published
   * its address has not published its rooms either.
   */
  async replaceImage(orgId: string, roomId: string, data: string, mimeType: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      select: { id: true, imagePath: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    // Browsers hand back a full data: URL from FileReader; accept either.
    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');

    const imagePath = await this.storage.uploadRoomImage(orgId, bytes, mimeType);

    const updated = await this.prisma.room.update({
      where: { id: room.id },
      data: { imagePath },
    });

    // Only now is the previous file unreferenced.
    if (room.imagePath) {
      await this.storage.deleteAttachment(orgId, room.imagePath).catch(() => {});
    }

    return this.withImageUrls([updated]).then((rooms) => rooms[0]);
  }

  async removeImage(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      select: { id: true, imagePath: true },
    });
    if (!room) throw new NotFoundException('Room not found');

    const updated = await this.prisma.room.update({
      where: { id: room.id },
      data: { imagePath: null },
    });

    if (room.imagePath) {
      await this.storage.deleteAttachment(orgId, room.imagePath).catch(() => {});
    }

    return updated;
  }

  /**
   * Attach a signed URL to each room that has a photo.
   *
   * One request for the whole list rather than one per room: a co-op with a
   * dozen rooms would otherwise make a dozen round trips to Storage to render
   * one screen.
   */
  private async withImageUrls<T extends { imagePath?: string | null }>(
    rooms: T[],
  ): Promise<(T & { imageUrl: string | null })[]> {
    const signed = await this.storage.signedAttachmentUrls(
      rooms.map((r) => r.imagePath).filter((p): p is string => Boolean(p)),
    );

    return rooms.map((room) => ({
      ...room,
      imageUrl: room.imagePath ? (signed.get(room.imagePath) ?? null) : null,
    }));
  }

  async listRooms(orgId: string, isStaff = false) {
    const rooms = await this.prisma.room.findMany({
      where: { orgId, isActive: true },
      include: { availabilityRules: true },
      orderBy: { name: 'asc' },
    });

    const withImages = await this.withImageUrls(rooms);

    if (isStaff) return withImages;

    return withImages.map(({ googleAccountEmail, googleConnectedAt, ...room }) => room);
  }

  async getRoom(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: {
        availabilityRules: true,
        bookings: {
          where: {
            startTime: { gte: new Date() },
            status: { in: ['APPROVED', 'PENDING'] },
          },
          orderBy: { startTime: 'asc' },
          take: 50,
        },
      },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return room;
  }

  /* ------------------------------------------------------------------ */
  /*  Availability Rules                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Replace a room's opening hours in one go (SPC-11).
   *
   * The editor shows the whole week, so what it sends is the complete answer.
   * Doing that as a delete-per-rule then a create-per-rule from the browser
   * was eleven round trips, and worse, not atomic: a failure halfway left the
   * room with its old hours deleted and its new ones not written, which turns
   * a room that opens at nine into one that cannot be booked at all — with
   * nothing on screen saying so.
   *
   * Blackouts are untouched. They are not represented in the editor, and
   * clearing them here would quietly reopen a room on a day the co-op closed.
   */
  async replaceOpeningHours(
    orgId: string,
    roomId: string,
    rules: AvailabilityRuleDto[],
  ) {
    await this.findRoomInOrg(orgId, roomId);

    return this.prisma.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({
        where: { roomId, isBlackout: false },
      });

      if (rules.length > 0) {
        await tx.availabilityRule.createMany({
          data: rules.map((rule) => ({
            roomId,
            dayOfWeek: rule.dayOfWeek ?? null,
            startTime: rule.startTime,
            endTime: rule.endTime,
            bufferMinutes: rule.bufferMinutes ?? 0,
            isBlackout: false,
            effectiveFrom: rule.effectiveFrom ? new Date(rule.effectiveFrom) : null,
            effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null,
          })),
        });
      }

      return tx.availabilityRule.findMany({
        where: { roomId },
        orderBy: [{ isBlackout: 'asc' }, { dayOfWeek: 'asc' }],
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Closures (SPC-12)                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Shut a room for a day, a run of days, or part of them.
   *
   * Stored as a blackout rule, which the slot engine already subtracts from
   * opening hours. What is new is that the dates arrive as *calendar* dates
   * and are turned into instants here, in the co-op's timezone: "closed on the
   * 25th" means the 25th where the room is, and a browser sending its own
   * midnight would shut the room on the wrong day for anyone travelling.
   *
   * The window runs from the first day's midnight to the last day's last
   * minute, so the engine's noon-of-the-day test falls inside it for every day
   * in between.
   */
  async addClosure(orgId: string, roomId: string, dto: ClosureDto) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: { org: { select: { timezone: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');

    const timeZone = room.org.timezone;
    const toDate = dto.toDate ?? dto.fromDate;

    if (toDate < dto.fromDate) {
      throw new BadRequestException('A closure cannot end before it starts.');
    }

    const startTime = dto.startTime ?? '00:00';
    const endTime = dto.endTime ?? '23:59';

    if (endTime <= startTime) {
      throw new BadRequestException(
        'A closure has to end after it starts. For a whole day, leave the times blank.',
      );
    }

    return this.prisma.availabilityRule.create({
      data: {
        roomId,
        // Every weekday inside the range. A closure that applied to one
        // weekday would be an odd thing to express as a date range.
        dayOfWeek: null,
        startTime,
        endTime,
        isBlackout: true,
        label: dto.label?.trim() || null,
        effectiveFrom: instantAt(dto.fromDate, 0, timeZone),
        effectiveTo: instantAt(toDate, 23 * 60 + 59, timeZone),
      },
    });
  }

  /**
   * The closures on a room, with their dates back in local terms.
   *
   * Rendered here rather than in the browser: the instants only mean the right
   * days once the co-op's timezone is applied, and that is knowledge the
   * server has and the client does not.
   */
  async listClosures(orgId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: { org: { select: { timezone: true } } },
    });
    if (!room) throw new NotFoundException('Room not found');

    const timeZone = room.org.timezone;
    const closures = await this.prisma.availabilityRule.findMany({
      where: { roomId, isBlackout: true },
      orderBy: { effectiveFrom: 'asc' },
    });

    return closures.map((rule) => ({
      id: rule.id,
      label: rule.label,
      fromDate: rule.effectiveFrom ? zonedParts(rule.effectiveFrom, timeZone).date : null,
      toDate: rule.effectiveTo ? zonedParts(rule.effectiveTo, timeZone).date : null,
      startTime: rule.startTime,
      endTime: rule.endTime,
      // A closure with no times covers the day; the editor shows that as a
      // checkbox rather than as 00:00 to 23:59.
      allDay: rule.startTime === '00:00' && rule.endTime === '23:59',
    }));
  }

  async removeClosure(orgId: string, roomId: string, closureId: string) {
    await this.findRoomInOrg(orgId, roomId);

    // Scoped to blackouts: this route must not become a way to delete a room's
    // opening hours one rule at a time.
    const closure = await this.prisma.availabilityRule.findFirst({
      where: { id: closureId, roomId, isBlackout: true },
    });
    if (!closure) throw new NotFoundException('Closure not found');

    return this.prisma.availabilityRule.delete({ where: { id: closure.id } });
  }

  async addAvailabilityRule(orgId: string, roomId: string, dto: AvailabilityRuleDto) {
    await this.findRoomInOrg(orgId, roomId);

    return this.prisma.availabilityRule.create({
      data: {
        roomId,
        dayOfWeek: dto.dayOfWeek ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        bufferMinutes: dto.bufferMinutes ?? 0,
        isBlackout: dto.isBlackout ?? false,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
    });
  }

  async removeAvailabilityRule(orgId: string, ruleId: string) {
    const rule = await this.prisma.availabilityRule.findFirst({
      where: { id: ruleId, room: { orgId } },
    });
    if (!rule) {
      throw new NotFoundException('Availability rule not found');
    }

    return this.prisma.availabilityRule.delete({ where: { id: ruleId } });
  }

  /* ------------------------------------------------------------------ */
  /*  Bookings                                                           */
  /* ------------------------------------------------------------------ */


  /**
   * Notify the member about a change to their booking.
   *
   * Always fire-and-forget: EmailService already swallows send failures, and a
   * booking must not fail because Postmark is down. Loads its own copy of the
   * booking so callers stay simple.
   *
   * The manage link points at the org's public portal, which exists. It is
   * deliberately NOT /member/bookings — that page has never been built, even
   * though the member dashboard links to it. Sending members to a 404 would be
   * worse than sending them somewhere real but general. See SPC-07.
   */
  /**
   * Render a booking window in the co-op's own timezone (SPC-08).
   *
   * These emails used to send `toUTCString()` — "Mon, 05 Apr 2027 10:00:00
   * GMT" — for a booking the member had made at 6am in the app. Everyone read
   * an hour that did not match what they booked, and the further from UTC a
   * co-op sits the worse it got.
   *
   * The org timezone this needed already existed on `Organization`, defaulting
   * to America/New_York, and Settings has had a selector for it all along;
   * SPC-08 recorded it as missing. The zone abbreviation is included because a
   * time without one is exactly the ambiguity being fixed.
   */
  private formatWhen(start: Date, end: Date, timeZone: string): string {
    const zone = timeZone || 'America/New_York';
    const day = (d: Date) =>
      d.toLocaleDateString('en-US', {
        timeZone: zone,
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    const clock = (d: Date, withZone = false) =>
      d.toLocaleTimeString('en-US', {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        ...(withZone ? { timeZoneName: 'short' } : {}),
      });

    // Same day is the common case; spanning midnight needs both dates.
    return day(start) === day(end)
      ? `${day(start)}, ${clock(start)} – ${clock(end, true)}`
      : `${day(start)}, ${clock(start)} – ${day(end)}, ${clock(end, true)}`;
  }

  private async notifyBooking(
    bookingId: string,
    kind: 'received' | 'confirmed' | 'rejected' | 'canceled' | 'rescheduled',
  ): Promise<void> {
    try {
      // tenant-scoping-exempt: private, and every caller has already resolved
      // this booking inside its org before asking for an email about it.
      const b = await this.prisma.booking.findUnique({
        where: { id: bookingId },
        include: {
          user: { select: { email: true, name: true } },
          room: {
            include: { org: { select: { name: true, slug: true, timezone: true } } },
          },
        },
      });
      if (!b?.user?.email) return;

      const webUrl = this.configService.get<string>('WEB_URL') || 'https://maybeos.org';
      const data = {
        memberName: b.user.name || 'there',
        roomName: b.room.name,
        orgName: b.room.org.name,
        title: b.title,
        when: this.formatWhen(b.startTime, b.endTime, b.room.org.timezone),
        manageUrl: `${webUrl}/portal/${b.room.org.slug}/rooms`,
      };

      const to = b.user.email;
      if (kind === 'received') await this.emailService.sendBookingReceived(to, data);
      else if (kind === 'confirmed') await this.emailService.sendBookingConfirmed(to, data);
      else if (kind === 'rejected') await this.emailService.sendBookingRejected(to, data);
      else if (kind === 'canceled') await this.emailService.sendBookingCanceled(to, data);
      else
        await this.emailService.sendBookingRescheduled(to, {
          ...data,
          needsApproval: b.status === 'PENDING',
        });
    } catch (err) {
      this.logger.warn(
        `Could not send ${kind} email for booking ${bookingId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async createBooking(orgId: string, roomId: string, userId: string, dto: CreateBookingDto) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: { availabilityRules: true, org: { select: { timezone: true } } },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    if (!room.isActive) {
      throw new BadRequestException('Room is not currently active');
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    // --- Check the room's own limit on how long a booking may run ---
    this.validateDuration(room.maxBookingMinutes, startTime, endTime);

    // --- Check availability rules ---
    this.validateAvailability(
      room.availabilityRules,
      startTime,
      endTime,
      room.alwaysAvailable,
      room.org.timezone,
    );

    // --- Check for conflicts ---
    const hasConflict = await this.checkConflicts(roomId, startTime, endTime);
    if (hasConflict) {
      throw new ConflictException('This time slot conflicts with an existing booking');
    }

    // --- And against the room's own Google Calendar (SPC-08) ---
    // Bookings were pushed to Google and nothing was ever read back, so a
    // co-op that put a rehearsal straight into the room's calendar would still
    // take a member's booking for the same hour and confirm it. Never throws:
    // Google being unreachable must not stop a co-op booking its own rooms.
    const { busy } = await this.calendar.busyConflictForRoom(
      orgId,
      roomId,
      startTime,
      endTime,
    );
    if (busy) {
      throw new ConflictException(
        "This time is already taken on the room's calendar",
      );
    }

    // A room only charges once an admin has switched it on and set a rate
    // (SPC-06). Either alone means free, so a half-filled form cannot start
    // billing people.
    const charges = room.chargeForBooking && !!room.hourlyRate;

    const status = charges
      ? 'PENDING_PAYMENT'
      : room.requiresApproval
        ? 'PENDING'
        : 'APPROVED';

    const created = await this.prisma.booking.create({
      data: {
        roomId,
        userId,
        title: dto.title,
        description: dto.description,
        startTime,
        endTime,
        status,
        // The hold that stops the slot being sold twice while the member is in
        // Stripe. Thirty minutes is long enough to find a card and short
        // enough that an abandoned checkout does not block a room all day.
        ...(charges ? { holdExpiresAt: new Date(Date.now() + 30 * 60 * 1000) } : {}),
      },
    });

    if (charges) {
      // Deliberately no email yet: nothing is booked until it is paid for, and
      // "your booking is confirmed" for an unpaid hold is a lie the member
      // acts on. The confirmation goes out from the webhook.
      try {
        const { url } = await this.connect.createBookingCheckout({
          orgId,
          bookingId: created.id,
          successUrl: `${this.webUrl()}/member/bookings?paid=1`,
          cancelUrl: `${this.webUrl()}/member/bookings?canceled=1`,
        });
        return { ...created, checkoutUrl: url };
      } catch (err) {
        // The hold exists to protect a payment that is starting. If no payment
        // can start, it protects nothing and blocks the slot for half an hour
        // — so a co-op still finishing Stripe onboarding would fill its own
        // calendar with holds while members are told the room is taken.
        await this.prisma.booking.delete({ where: { id: created.id } }).catch(() => {
          this.logger.error(
            `Checkout failed for booking ${created.id} and the hold could not be removed`,
          );
        });
        throw err;
      }
    }

    // Only a confirmed booking goes on the calendar. Publishing a request
    // that an organiser may refuse would show the room as taken when it is
    // not, which is worse than showing nothing.
    if (status === 'APPROVED') {
      await this.calendar.syncBooking(orgId, created.id, 'create');
    }

    // 'received' when it still needs an organiser; 'confirmed' when the room
    // auto-approves and the member can just turn up.
    await this.notifyBooking(created.id, status === 'PENDING' ? 'received' : 'confirmed');

    return created;
  }

  /** Where the member comes back to after Stripe. */
  private webUrl(): string {
    const configured =
      this.configService.get<string>('WEB_URL') || 'http://localhost:3000';
    return configured.split(',')[0].trim().replace(/\/+$/, '');
  }

  async approveBooking(orgId: string, bookingId: string, reviewerId: string) {
    const booking = await this.findBookingInOrg(orgId, bookingId);

    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Only pending bookings can be approved');
    }

    const approved = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    await this.calendar.syncBooking(orgId, approved.id, 'create');

    await this.notifyBooking(approved.id, 'confirmed');
    return approved;
  }

  async rejectBooking(orgId: string, bookingId: string, reviewerId: string) {
    const booking = await this.findBookingInOrg(orgId, bookingId);

    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Only pending bookings can be rejected');
    }

    const rejected = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });

    await this.calendar.syncBooking(orgId, rejected.id, 'delete');

    // Refused, so the money goes back — including MaybeOS's fee. Charging a
    // co-op for an hour its own organiser declined would be indefensible.
    await this.connect.refundBooking(orgId, rejected.id).catch((err) =>
      this.logger.error(
        `Booking ${rejected.id} rejected but the refund failed: ${err.message}`,
      ),
    );

    // A booking can hold an event and still reach REJECTED: rescheduling an
    // approved booking sends it back into the queue (see rescheduleBooking),
    // and an organiser can refuse the new slot. The event must not survive it.
    await this.eventsService
      .syncWithBooking(rejected.id, { canceled: true })
      .catch((err) =>
        this.logger.error(
          `Booking ${rejected.id} rejected but its event was not cancelled: ${err.message}`,
        ),
      );

    await this.notifyBooking(rejected.id, 'rejected');
    return rejected;
  }

  /**
   * Load a booking and confirm the caller is allowed to act on it.
   *
   * Two checks, both previously missing. `cancelBooking` took only a booking
   * id: the controller never passed the current user, and the `orgId` route
   * param was unused. Any authenticated member could therefore cancel any
   * booking in any organization simply by knowing its UUID — the org guard
   * passed because they were a member of the org *in the URL*, which was never
   * compared against the booking's own org. Same family as D-009.
   */
  private async loadBookingForActor(
    orgId: string,
    bookingId: string,
    userId: string,
    isStaff: boolean,
  ) {
    // The org filter is part of the query rather than a follow-up comparison:
    // same result, but it cannot be separated from the lookup by a later edit.
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, room: { orgId } },
      include: {
        room: {
          include: { availabilityRules: true, org: { select: { timezone: true } } },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // Members may act on their own bookings; staff and admins on any in the org.
    if (booking.userId !== userId && !isStaff) {
      throw new ForbiddenException('This is not your booking');
    }

    return booking;
  }

  /**
   * Move a booking to a new time.
   *
   * Re-runs the same availability and conflict checks as a new booking, but
   * excludes this booking from the conflict search — otherwise every reschedule
   * would collide with itself. `checkConflicts` has always accepted
   * `excludeBookingId` for exactly this and nothing used it until now.
   */
  async rescheduleBooking(
    orgId: string,
    bookingId: string,
    userId: string,
    isStaff: boolean,
    dto: { startTime: string; endTime: string },
  ) {
    const booking = await this.loadBookingForActor(orgId, bookingId, userId, isStaff);

    if (booking.status === 'CANCELED' || booking.status === 'REJECTED') {
      throw new BadRequestException(
        `A ${booking.status.toLowerCase()} booking cannot be rescheduled. Make a new one.`,
      );
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);

    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time');
    }

    if (!booking.room.isActive) {
      throw new BadRequestException('Room is not currently active');
    }

    this.validateDuration(booking.room.maxBookingMinutes, startTime, endTime);

    this.validateAvailability(
      booking.room.availabilityRules,
      startTime,
      endTime,
      booking.room.alwaysAvailable,
      booking.room.org.timezone,
    );

    const hasConflict = await this.checkConflicts(
      booking.roomId,
      startTime,
      endTime,
      bookingId,
    );
    if (hasConflict) {
      throw new ConflictException('This time slot conflicts with an existing booking');
    }

    // The room's Google Calendar counts here too (SPC-08), minus this
    // booking's own event — a booking being moved would otherwise collide
    // with the copy of itself that is already on the calendar.
    const { busy } = await this.calendar.busyConflictForRoom(
      orgId,
      booking.roomId,
      startTime,
      endTime,
      booking.googleEventId,
    );
    if (busy) {
      throw new ConflictException(
        "This time is already taken on the room's calendar",
      );
    }

    // An admin approved a *specific* slot. Moving it means that approval no
    // longer describes what was agreed, so a member's reschedule re-enters the
    // queue. Staff moving a booking is itself the approval, so it stays put.
    const status =
      booking.room.requiresApproval && !isStaff ? 'PENDING' : booking.status;

    const moved = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        startTime,
        endTime,
        status,
        ...(status === 'PENDING' ? { reviewedBy: null, reviewedAt: null } : {}),
      },
    });

    await this.eventsService
      .syncWithBooking(moved.id, { startTime, endTime })
      .catch((err) =>
        this.logger.error(
          `Booking ${moved.id} moved but its event was not: ${err.message}`,
        ),
      );

    // 'update' falls back to creating when there is nothing on the calendar
    // yet, which is the case for a booking rescheduled before approval.
    await this.calendar.syncBooking(orgId, moved.id, 'update');

    await this.notifyBooking(moved.id, 'rescheduled');
    return moved;
  }

  async cancelBooking(
    orgId: string,
    bookingId: string,
    userId: string,
    isStaff: boolean,
  ) {
    const booking = await this.loadBookingForActor(orgId, bookingId, userId, isStaff);

    if (booking.status === 'CANCELED') {
      throw new BadRequestException('Booking is already canceled');
    }

    const canceled = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });

    await this.calendar.syncBooking(orgId, canceled.id, 'delete');

    // Paid for, so the money goes back — MaybeOS's fee included. Never allowed
    // to fail the cancellation: a member calling off a booking must always
    // succeed, or they keep a room they gave up and their money is stuck too.
    await this.connect.refundBooking(orgId, canceled.id).catch((err) =>
      this.logger.error(
        `Booking ${canceled.id} cancelled but the refund failed: ${err.message}`,
      ),
    );

    // Cancelling the room cancels what was advertised in it. Doing this after
    // the booking is safely updated, and never letting it fail the cancel:
    // a member calling off a booking must always succeed.
    await this.eventsService
      .syncWithBooking(canceled.id, { canceled: true })
      .catch((err) =>
        this.logger.error(
          `Booking ${canceled.id} cancelled but its event was not: ${err.message}`,
        ),
      );

    await this.notifyBooking(canceled.id, 'canceled');
    return canceled;
  }

  async listBookings(
    orgId: string,
    roomId: string,
    from: Date,
    to: Date,
    viewer: ContactViewer,
  ) {
    await this.findRoomInOrg(orgId, roomId);

    return this.prisma.booking.findMany({
      where: {
        roomId,
        startTime: { gte: from },
        endTime: { lte: to },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            avatarPath: true,
            // Seeing who booked the studio on Tuesday is the point of this
            // list; being handed their email address is not. Organisers keep
            // it, because chasing a booking is their job.
            email: viewer.privileged,
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async listUserBookings(userId: string, orgId: string) {
    return this.prisma.booking.findMany({
      where: {
        userId,
        room: { orgId },
      },
      include: {
        room: { select: { id: true, name: true, locationId: true } },
      },
      orderBy: { startTime: 'desc' },
    });
  }

  /**
   * Every candidate slot on a date, and whether each can be booked (SPC-09).
   *
   * The one place that merges what the room publishes, what members have
   * already taken, and what the room's own Google Calendar says. Those three
   * lived in `validateAvailability`, `checkConflicts` and `busyConflict`, each
   * reachable only by attempting a booking and reading the refusal — so the
   * only way to find a free hour was to guess at one.
   */
  async slots(
    orgId: string,
    roomId: string,
    date: string,
    durationMinutes: number,
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: { availabilityRules: true, org: { select: { timezone: true } } },
    });

    if (!room) throw new NotFoundException('Room not found');

    const timeZone = room.org.timezone;
    const dayStart = instantAt(date, 0, timeZone);
    // A day is not always 24 hours: the window runs to midnight local, which
    // is 23 or 25 hours long on the mornings the clocks change.
    const dayEnd = instantAt(date, 0, timeZone);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    const [taken, calendar] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          roomId,
          startTime: { lt: dayEnd },
          endTime: { gt: dayStart },
          OR: [
            { status: { in: ['APPROVED', 'PENDING'] } },
            // A slot being paid for is taken, and an expired hold is not.
            { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } },
          ],
        },
        select: { startTime: true, endTime: true },
      }),
      // Never throws and never blocks the page: a room with no calendar, or
      // Google being unreachable, returns nothing busy and the local rules
      // still apply.
      this.calendar.busyForRoom(orgId, roomId, dayStart, dayEnd),
    ]);

    const slots = slotsForDate({
      date,
      timeZone,
      durationMinutes,
      alwaysAvailable: room.alwaysAvailable,
      rules: room.availabilityRules,
      booked: taken.map((b) => ({ start: b.startTime, end: b.endTime })),
      busy: calendar,
      now: new Date(),
    });

    return {
      date,
      timeZone,
      durationMinutes,
      durations: durationsFor(room.maxBookingMinutes),
      maxBookingMinutes: room.maxBookingMinutes,
      slots,
    };
  }

  /**
   * Which days in a month have anything left — the dots on the calendar.
   *
   * One free/busy call for the whole month rather than one per day: thirty
   * round trips to Google to render one month view would make the calendar
   * slower than the booking it exists to start.
   */
  async openDays(
    orgId: string,
    roomId: string,
    month: string,
    durationMinutes: number,
  ) {
    const room = await this.prisma.room.findFirst({
      where: { id: roomId, orgId },
      include: { availabilityRules: true, org: { select: { timezone: true } } },
    });

    if (!room) throw new NotFoundException('Room not found');

    const timeZone = room.org.timezone;
    const dates = datesInMonth(month);
    const from = instantAt(dates[0], 0, timeZone);
    const to = instantAt(dates[dates.length - 1], 0, timeZone);
    to.setUTCDate(to.getUTCDate() + 1);

    const [taken, calendar] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          roomId,
          startTime: { lt: to },
          endTime: { gt: from },
          OR: [
            { status: { in: ['APPROVED', 'PENDING'] } },
            { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } },
          ],
        },
        select: { startTime: true, endTime: true },
      }),
      this.calendar.busyForRoom(orgId, roomId, from, to),
    ]);

    const booked = taken.map((b) => ({ start: b.startTime, end: b.endTime }));
    const now = new Date();

    const open = dates.filter((date) =>
      hasAnyOpening({
        date,
        timeZone,
        durationMinutes,
        alwaysAvailable: room.alwaysAvailable,
        rules: room.availabilityRules,
        booked,
        busy: calendar,
        now,
      }),
    );

    return { month, timeZone, open };
  }

  async checkConflicts(
    roomId: string,
    startTime: Date,
    endTime: Date,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const conflicting = await this.prisma.booking.findFirst({
      where: {
        roomId,
        ...(excludeBookingId && { id: { not: excludeBookingId } }),
        OR: [
          { status: { in: ['APPROVED', 'PENDING'] } },
          // A slot being paid for is taken (SPC-06). Ignoring these would let
          // two members pay for the same hour, and only one can have it.
          // Expired holds are ignored, so an abandoned checkout frees the room
          // even before the scheduler sweeps it.
          {
            status: 'PENDING_PAYMENT',
            holdExpiresAt: { gt: new Date() },
          },
        ],
        // Overlapping: existing.start < newEnd AND existing.end > newStart
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });

    return !!conflicting;
  }

  /* ------------------------------------------------------------------ */
  /*  Private helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Validate a proposed booking against the room's availability rules.
   *
   * - At least one non-blackout rule must cover the requested time.
   * - No blackout rule may overlap the requested time.
   */
  /**
   * A booking may not run longer than the room allows (SPC-09).
   *
   * Checked here as well as in the duration chips: the chips are what a member
   * sees, and a request that never went through them is exactly the one this
   * exists to stop.
   */
  private validateDuration(
    maxBookingMinutes: number | null,
    startTime: Date,
    endTime: Date,
  ): void {
    if (!maxBookingMinutes) return;

    const requested = (endTime.getTime() - startTime.getTime()) / 60_000;
    if (requested > maxBookingMinutes) {
      const hours = maxBookingMinutes / 60;
      const limit =
        maxBookingMinutes % 60 === 0
          ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
          : `${maxBookingMinutes} minutes`;

      throw new BadRequestException(
        `This room can be booked for up to ${limit} at a time.`,
      );
    }
  }

  private validateAvailability(
    rules: {
      dayOfWeek: number | null;
      startTime: string;
      endTime: string;
      isBlackout: boolean;
      effectiveFrom: Date | null;
      effectiveTo: Date | null;
    }[],
    startTime: Date,
    endTime: Date,
    alwaysAvailable: boolean,
    timeZone: string,
  ): void {
    // Said deliberately, or not at all.
    if (alwaysAvailable) {
      return;
    }

    // No rules and not marked always-open is an unfinished room, not a room
    // that is open around the clock. Those were the same state until 2026-08-19,
    // so adding a room and not getting to its hours published it at 3am.
    if (rules.length === 0) {
      throw new BadRequestException(
        'This room has no bookable hours yet. An organiser needs to set its availability, or mark it as always available.',
      );
    }

    // In the co-op's own timezone. These were `getUTCDay()` and
    // `getUTCHours()`, so "09:00-17:00" meant 5am-1pm for every organisation
    // on the default America/New_York — and the weekday a late-evening booking
    // was tested against was tomorrow's. No rule had been written anywhere
    // when this was found, so the semantics changed rather than the data.
    const local = zonedParts(startTime, timeZone);
    const dayOfWeek = local.dayOfWeek;
    const bookingStart = local.minutes;
    // Measured from the start rather than read off the end, so a booking that
    // finishes at midnight compares as 24:00 and not as 00:00.
    const bookingEnd =
      bookingStart + (endTime.getTime() - startTime.getTime()) / 60_000;

    // Filter rules that are effective for the requested date.
    const applicableRules = rules.filter((rule) => {
      if (rule.dayOfWeek !== null && rule.dayOfWeek !== dayOfWeek) {
        return false;
      }
      if (rule.effectiveFrom && startTime < rule.effectiveFrom) {
        return false;
      }
      if (rule.effectiveTo && startTime > rule.effectiveTo) {
        return false;
      }
      return true;
    });

    // Check blackout rules first.
    const blackoutRules = applicableRules.filter((r) => r.isBlackout);
    for (const rule of blackoutRules) {
      const ruleStart = this.parseHHmm(rule.startTime);
      const ruleEnd = this.parseHHmm(rule.endTime);

      // If the booking overlaps with a blackout window, reject it.
      if (bookingStart < ruleEnd && bookingEnd > ruleStart) {
        throw new BadRequestException(
          'The requested time falls within a blackout period',
        );
      }
    }

    // Check that at least one allow rule covers the booking time.
    //
    // The condition is whether the room defines opening hours *at all*, not
    // whether it defines them for this particular day. Testing
    // `applicableRules` here — already filtered to the booking's weekday —
    // meant a room whose only rule was "Mondays 09:00-17:00" had no allow
    // rules on a Tuesday, so the check was skipped and the booking approved.
    // A co-op publishing one day of opening hours got a room bookable at 3am
    // on a Sunday (SPC-05, found by executing the path rather than reading it).
    //
    // A room with only blackout rules still means "open except these times",
    // which is why this asks for an allow rule specifically.
    const definesOpeningHours = rules.some((r) => !r.isBlackout);

    if (definesOpeningHours) {
      const allowRules = applicableRules.filter((r) => !r.isBlackout);
      const isCovered = allowRules.some((rule) => {
        const ruleStart = this.parseHHmm(rule.startTime);
        const ruleEnd = this.parseHHmm(rule.endTime);
        return bookingStart >= ruleStart && bookingEnd <= ruleEnd;
      });

      if (!isCovered) {
        throw new BadRequestException(
          'The requested time is outside the room\'s available hours',
        );
      }
    }
  }

  /** Convert a Date to minutes since midnight (UTC). */
  private toMinutes(date: Date): number {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  /** Parse an "HH:mm" string into minutes since midnight. */
  private parseHHmm(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}
