import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
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

  async update(eventId: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

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

  async publish(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        isPublished: true,
        publishedAt: new Date(),
      },
    });
  }

  /* ─── Cancel ────────────────────────────────────────────────── */

  async cancel(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    return this.prisma.event.update({
      where: { id: eventId },
      data: {
        canceledAt: new Date(),
      },
    });
  }

  /* ─── Find by ID ────────────────────────────────────────────── */

  async findById(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        rsvps: true,
        room: true,
        location: true,
      },
    });

    if (!event) throw new NotFoundException('Event not found');
    return event;
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
          _count: { select: { rsvps: true } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data,
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
          _count: { select: { rsvps: true } },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return {
      data,
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
        _count: { select: { rsvps: { where: { status: 'CONFIRMED' } } } },
      },
    });

    if (!event) throw new NotFoundException('Event not found');

    if (event.visibility !== 'PUBLIC' || !event.isPublished) {
      throw new NotFoundException('Event not found');
    }

    return event;
  }

  /* ─── RSVP ──────────────────────────────────────────────────── */

  async rsvp(eventId: string, userId: string | null, dto: RsvpDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { _count: { select: { rsvps: { where: { status: 'CONFIRMED' } } } } },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (event.canceledAt) throw new BadRequestException('Event has been canceled');

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

  /* ─── Cancel RSVP ──────────────────────────────────────────── */

  async cancelRsvp(eventId: string, userId: string) {
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

  async checkIn(eventId: string, userId: string) {
    const rsvp = await this.prisma.rsvp.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (!rsvp) throw new NotFoundException('RSVP not found');
    if (rsvp.checkedIn) throw new BadRequestException('Already checked in');

    const [updatedRsvp, attendance] = await this.prisma.$transaction([
      this.prisma.rsvp.update({
        where: { id: rsvp.id },
        data: {
          checkedIn: true,
          checkedInAt: new Date(),
        },
      }),
      this.prisma.attendance.create({
        data: {
          eventId,
          userId,
          method: 'manual',
        },
      }),
    ]);

    return { rsvp: updatedRsvp, attendance };
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
