import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';

@Injectable()
export class OrgService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an organization, auto-creates the founding user as ADMIN,
   * and seeds a default "General" channel.
   */
  async create(dto: CreateOrgDto, userId: string) {
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
      data: { settings: merged },
    });
  }
}
