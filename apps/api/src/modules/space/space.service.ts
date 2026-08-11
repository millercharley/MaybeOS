import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { AvailabilityRuleDto } from './dto/availability-rule.dto';

@Injectable()
export class SpaceService {
  constructor(private prisma: PrismaService) {}

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
        hourlyRate: dto.hourlyRate,
      },
    });
  }

  async updateRoom(roomId: string, dto: Partial<CreateRoomDto>) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

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
        ...(dto.hourlyRate !== undefined && { hourlyRate: dto.hourlyRate }),
      },
    });
  }

  async listRooms(orgId: string) {
    return this.prisma.room.findMany({
      where: { orgId, isActive: true },
      include: { availabilityRules: true },
      orderBy: { name: 'asc' },
    });
  }

  async getRoom(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
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

  async addAvailabilityRule(roomId: string, dto: AvailabilityRuleDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

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

  async removeAvailabilityRule(ruleId: string) {
    const rule = await this.prisma.availabilityRule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new NotFoundException('Availability rule not found');
    }

    return this.prisma.availabilityRule.delete({ where: { id: ruleId } });
  }

  /* ------------------------------------------------------------------ */
  /*  Bookings                                                           */
  /* ------------------------------------------------------------------ */

  async createBooking(roomId: string, userId: string, dto: CreateBookingDto) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { availabilityRules: true },
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

    // --- Check availability rules ---
    this.validateAvailability(room.availabilityRules, startTime, endTime);

    // --- Check for conflicts ---
    const hasConflict = await this.checkConflicts(roomId, startTime, endTime);
    if (hasConflict) {
      throw new ConflictException('This time slot conflicts with an existing booking');
    }

    const status = room.requiresApproval ? 'PENDING' : 'APPROVED';

    return this.prisma.booking.create({
      data: {
        roomId,
        userId,
        title: dto.title,
        description: dto.description,
        startTime,
        endTime,
        status,
      },
    });
  }

  async approveBooking(bookingId: string, reviewerId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Only pending bookings can be approved');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'APPROVED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  async rejectBooking(bookingId: string, reviewerId: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    if (booking.status !== 'PENDING') {
      throw new BadRequestException('Only pending bookings can be rejected');
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'REJECTED',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
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
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { room: { include: { availabilityRules: true } } },
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    // The booking must belong to the org in the URL, or a member of one co-op
    // can reach into another's.
    if (booking.room.orgId !== orgId) {
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

    this.validateAvailability(booking.room.availabilityRules, startTime, endTime);

    const hasConflict = await this.checkConflicts(
      booking.roomId,
      startTime,
      endTime,
      bookingId,
    );
    if (hasConflict) {
      throw new ConflictException('This time slot conflicts with an existing booking');
    }

    // An admin approved a *specific* slot. Moving it means that approval no
    // longer describes what was agreed, so a member's reschedule re-enters the
    // queue. Staff moving a booking is itself the approval, so it stays put.
    const status =
      booking.room.requiresApproval && !isStaff ? 'PENDING' : booking.status;

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        startTime,
        endTime,
        status,
        ...(status === 'PENDING' ? { reviewedBy: null, reviewedAt: null } : {}),
      },
    });
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

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'CANCELED',
        canceledAt: new Date(),
      },
    });
  }

  async listBookings(roomId: string, from: Date, to: Date) {
    return this.prisma.booking.findMany({
      where: {
        roomId,
        startTime: { gte: from },
        endTime: { lte: to },
      },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
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

  async checkConflicts(
    roomId: string,
    startTime: Date,
    endTime: Date,
    excludeBookingId?: string,
  ): Promise<boolean> {
    const conflicting = await this.prisma.booking.findFirst({
      where: {
        roomId,
        status: { in: ['APPROVED', 'PENDING'] },
        ...(excludeBookingId && { id: { not: excludeBookingId } }),
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
  ): void {
    // If no rules are configured, the room is considered always available.
    if (rules.length === 0) {
      return;
    }

    const dayOfWeek = startTime.getUTCDay();
    const bookingStart = this.toMinutes(startTime);
    const bookingEnd = this.toMinutes(endTime);

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
    const allowRules = applicableRules.filter((r) => !r.isBlackout);
    if (allowRules.length > 0) {
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
