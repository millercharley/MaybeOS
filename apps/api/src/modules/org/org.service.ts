import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { RESERVED_ORG_SLUGS } from './reserved-slugs';
import { UpdateOrgDto } from './dto/update-org.dto';

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
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

  /**
   * Add a physical location to an organization.
   */
  async addLocation(
    orgId: string,
    dto: { name: string; address?: string; city?: string; state?: string; zip?: string; country?: string; timezone?: string },
  ) {
    await this.findById(orgId); // ensure org exists

    return this.prisma.location.create({
      data: {
        orgId,
        name: dto.name,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        zip: dto.zip,
        country: dto.country ?? 'US',
        timezone: dto.timezone ?? 'America/New_York',
      },
    });
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
