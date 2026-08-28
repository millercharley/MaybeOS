import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { StorageService } from '../storage/storage.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { RESERVED_ORG_SLUGS } from './reserved-slugs';
import { UpdateOrgDto } from './dto/update-org.dto';
import { ForumService } from './forum.service';

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly forum: ForumService,
  ) {}

  /**
   * Replace an org's logo (OPS-03c, D-017).
   *
   * Order matters and is the whole design: upload first, write `logoUrl` only
   * once the object is actually stored, and delete the previous file last. A
   * failure at any step leaves the org with the logo it had, never with a
   * broken link — which is why the upload writes to a fresh key rather than
   * overwriting.
   */
  async replaceLogo(orgId: string, data: string, mimeType: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, logoUrl: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization "${orgId}" not found`);
    }

    // Accept either a bare base64 string or a full data: URL, since browsers
    // hand back the latter from FileReader.
    const base64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const bytes = Buffer.from(base64.replace(/\s/g, ''), 'base64');

    const logoUrl = await this.storage.uploadOrgLogo(orgId, bytes, mimeType);

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { logoUrl },
    });

    // Only now is the old file unreferenced.
    await this.storage.deleteOrgLogo(orgId, org.logoUrl);

    return updated;
  }

  /** Remove the logo entirely, falling back to the initial-letter mark. */
  async removeLogo(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, logoUrl: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization "${orgId}" not found`);
    }

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { logoUrl: null },
    });

    await this.storage.deleteOrgLogo(orgId, org.logoUrl);

    return updated;
  }

  /**
   * Creates an organization, auto-creates the founding user as ADMIN,
   * and seeds a default "General" channel.
   */
  async create(dto: CreateOrgDto, userId: string) {
    if (RESERVED_ORG_SLUGS.includes(dto.slug)) {
      throw new ConflictException(`Slug "${dto.slug}" is reserved`);
    }

    const existing = await this.prisma.organization.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(`Slug "${dto.slug}" is already taken`);
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          mission: dto.mission,
          timezone: dto.timezone ?? 'America/New_York',
        },
      });

      // Auto-create the founding user with ADMIN role
      await tx.userOrg.create({
        data: {
          userId,
          orgId: org.id,
          role: 'ADMIN',
        },
      });

      // Into MaybeOS's own forum, so a new organiser has somebody to ask
      // (FRM-01). Inside the transaction so a co-op and its founder's forum
      // membership arrive together — and silent about every reason to
      // decline, because nothing here may stop somebody founding a co-op.
      await this.forum.autoJoin(userId, org.id, tx);

      // Seed a default "General" channel
      await tx.channel.create({
        data: {
          orgId: org.id,
          name: 'General',
          slug: 'general',
          description: 'Default discussion channel',
          isDefault: true,
          isPublic: true,
        },
      });

      return org;
    });
  }

  /**
   * Find an organization by its URL slug, including locations and tiers.
   */
  async findBySlug(slug: string) {
    const org = await this.prisma.organization.findUnique({
      where: { slug },
      include: {
        locations: true,
        tiers: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!org) {
      throw new NotFoundException(`Organization with slug "${slug}" not found`);
    }

    return org;
  }

  /**
   * Find an organization by its ID.
   */
  async findById(id: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!org) {
      throw new NotFoundException(`Organization with id "${id}" not found`);
    }

    return org;
  }

  /**
   * Update an organization's fields.
   */
  async update(orgId: string, dto: UpdateOrgDto) {
    await this.findById(orgId); // ensure it exists

    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...dto,
      },
    });
  }

  /**
   * Paginated listing of organizations.
   */
  async listOrgs(page: number = 1, perPage: number = 20) {
    const skip = (page - 1) * perPage;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.organization.count(),
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

  /* ─── Locations (ORG-01) ────────────────────────────────────── */

  /**
   * Where the co-op is.
   *
   * The model has existed since the foundation with exactly one endpoint
   * behind it — create — and no caller anywhere in the product, so no co-op
   * has ever had a location. Rooms and events both carry a nullable
   * `locationId` that has therefore always been null.
   */
  async listLocations(orgId: string) {
    const locations = await this.prisma.location.findMany({
      where: { orgId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { rooms: true, events: true } } },
    });

    return locations.map(({ _count, ...location }) => ({
      ...location,
      roomCount: _count.rooms,
      eventCount: _count.events,
    }));
  }

  /** Add a place the co-op actually is. */
  async addLocation(orgId: string, dto: CreateLocationDto) {
    await this.findById(orgId); // ensure org exists

    // The first one is the default, so a co-op with a single address never
    // has to think about the concept at all.
    const existing = await this.prisma.location.count({ where: { orgId } });

    return this.prisma.location.create({
      data: {
        orgId,
        name: dto.name.trim(),
        address: dto.address?.trim() || null,
        city: dto.city?.trim() || null,
        state: dto.state?.trim() || null,
        zip: dto.zip?.trim() || null,
        country: dto.country?.trim() || 'US',
        timezone: dto.timezone?.trim() || 'America/New_York',
        isDefault: existing === 0,
      },
    });
  }

  async updateLocation(orgId: string, locationId: string, dto: UpdateLocationDto) {
    const location = await this.findLocation(orgId, locationId);

    return this.prisma.location.update({
      where: { id: location.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.address !== undefined && { address: dto.address.trim() || null }),
        ...(dto.city !== undefined && { city: dto.city.trim() || null }),
        ...(dto.state !== undefined && { state: dto.state.trim() || null }),
        ...(dto.zip !== undefined && { zip: dto.zip.trim() || null }),
        ...(dto.country !== undefined && { country: dto.country.trim() || 'US' }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone.trim() || 'America/New_York' }),
      },
    });
  }

  /**
   * Remove a location, but not one anything still points at.
   *
   * The foreign keys are `SET NULL`, so deleting a location in use would
   * succeed *silently* and blank the venue on every event and room that named
   * it — including past events, whose record of where they happened would be
   * quietly rewritten. Refused with a count instead, so an organiser moves
   * them deliberately.
   */
  async removeLocation(orgId: string, locationId: string) {
    const location = await this.findLocation(orgId, locationId);

    const [rooms, events] = await Promise.all([
      this.prisma.room.count({ where: { locationId: location.id } }),
      this.prisma.event.count({ where: { locationId: location.id } }),
    ]);

    if (rooms > 0 || events > 0) {
      const parts = [
        rooms > 0 ? `${rooms} ${rooms === 1 ? 'room' : 'rooms'}` : null,
        events > 0 ? `${events} ${events === 1 ? 'event' : 'events'}` : null,
      ].filter(Boolean);

      const one = rooms + events === 1;
      throw new ConflictException(
        `${parts.join(' and ')} still ${one ? 'names' : 'name'} this location. ` +
          `Move ${one ? 'it' : 'them'} first — deleting it would blank where ${one ? 'it' : 'they'} happened.`,
      );
    }

    await this.prisma.location.delete({ where: { id: location.id } });
    return { removed: true };
  }

  /** Resolve a location through its org — never by bare id (SEC-04). */
  private async findLocation(orgId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, orgId },
      select: { id: true },
    });
    if (!location) throw new NotFoundException('Location not found');
    return location;
  }

  /**
   * Return the org's settings JSON.
   */
  async getSettings(orgId: string) {
    const org = await this.findById(orgId);
    return org.settings;
  }

  /**
   * Update the org's settings JSON (shallow merge).
   */
  async updateSettings(orgId: string, settings: Record<string, unknown>) {
    const org = await this.findById(orgId);
    const merged = { ...(org.settings as Record<string, unknown>), ...settings };

    return this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: merged as any },
    });
  }
}
