import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateTierDto } from './dto/create-tier.dto';

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Members ────────────────────────────────────────────────

  /**
   * Paginated list of members for an org, with optional search by name/email.
   */
  async listMembers(
    orgId: string,
    page: number = 1,
    perPage: number = 20,
    search?: string,
  ) {
    const skip = (page - 1) * perPage;

    const where: any = { orgId };

    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.userOrg.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { memberSince: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
            },
          },
          tier: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this.prisma.userOrg.count({ where }),
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
   * Get a single member's detail within an org.
   */
  async getMember(orgId: string, userId: string) {
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        tier: true,
      },
    });

    if (!member) {
      throw new NotFoundException(
        `Member not found for user "${userId}" in org "${orgId}"`,
      );
    }

    return member;
  }

  /**
   * Update a member's role within an org.
   */
  async updateMemberRole(orgId: string, userId: string, role: string) {
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!member) {
      throw new NotFoundException(
        `Member not found for user "${userId}" in org "${orgId}"`,
      );
    }

    return this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: { role: role as any },
    });
  }

  /**
   * Add a user as a member of an org.
   */
  async addMember(
    orgId: string,
    userId: string,
    tierId: string | null,
    role: string,
  ) {
    const existing = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (existing) {
      throw new ConflictException(
        `User "${userId}" is already a member of org "${orgId}"`,
      );
    }

    return this.prisma.userOrg.create({
      data: {
        userId,
        orgId,
        tierId,
        role: role as any,
      },
    });
  }

  /**
   * Remove a member from an org.
   */
  async removeMember(orgId: string, userId: string) {
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    if (!member) {
      throw new NotFoundException(
        `Member not found for user "${userId}" in org "${orgId}"`,
      );
    }

    return this.prisma.userOrg.delete({
      where: { userId_orgId: { userId, orgId } },
    });
  }

  // ─── Tiers ─────────────────────────────────────────────────

  /**
   * Create a membership tier for an org.
   */
  async createTier(orgId: string, dto: CreateTierDto) {
    // Determine next sort order
    const maxSort = await this.prisma.membershipTier.aggregate({
      where: { orgId },
      _max: { sortOrder: true },
    });
    const nextOrder = (maxSort._max.sortOrder ?? -1) + 1;

    return this.prisma.membershipTier.create({
      data: {
        orgId,
        name: dto.name,
        description: dto.description,
        priceMonthly: dto.priceMonthly,
        priceYearly: dto.priceYearly,
        isPayWhatYouCan: dto.isPayWhatYouCan ?? false,
        minPrice: dto.minPrice,
        benefits: dto.benefits ?? [],
        sortOrder: nextOrder,
      },
    });
  }

  /**
   * List active tiers for an org, sorted by sortOrder.
   */
  async listTiers(orgId: string) {
    return this.prisma.membershipTier.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Update a membership tier.
   */
  async updateTier(
    orgId: string,
    tierId: string,
    dto: Partial<CreateTierDto>,
  ) {
    const tier = await this.prisma.membershipTier.findFirst({
      where: { id: tierId, orgId },
    });

    if (!tier) {
      throw new NotFoundException(
        `Tier "${tierId}" not found in org "${orgId}"`,
      );
    }

    return this.prisma.membershipTier.update({
      where: { id: tierId },
      data: {
        ...dto,
      },
    });
  }

  // ─── Invitations ────────────────────────────────────────────

  async inviteMember(
    orgId: string,
    email: string,
    role: string,
    invitedByUserId: string,
  ) {
    const normalizedEmail = email.toLowerCase().trim();

    const existing = await this.prisma.userOrg.findFirst({
      where: {
        orgId,
        user: { email: normalizedEmail },
      },
    });
    if (existing) {
      throw new ConflictException('This person is already a member of this organization');
    }

    const pendingInvite = await this.prisma.invitation.findFirst({
      where: {
        orgId,
        email: normalizedEmail,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingInvite) {
      throw new ConflictException('An invitation has already been sent to this email');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedByUserId },
    });

    const invitation = await this.prisma.invitation.create({
      data: {
        orgId,
        email: normalizedEmail,
        role: role as any,
        invitedBy: invitedByUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const webUrl = this.configService.get<string>('WEB_URL');
    const inviteUrl = `${webUrl}/invite?token=${invitation.token}`;

    await this.emailService.sendInvite(
      normalizedEmail,
      org.name,
      inviteUrl,
      inviter?.name || undefined,
    );

    return { id: invitation.id, email: normalizedEmail, status: 'sent' };
  }

  async getInviteByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { org: { select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true } } },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('This invitation has already been accepted');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('This invitation has expired');

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      org: invitation.org,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvite(token: string, userId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('This invitation has already been accepted');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('This invitation has expired');

    const existing = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId: invitation.orgId } },
    });
    if (existing) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return { status: 'already_member', orgId: invitation.orgId };
    }

    await this.prisma.$transaction([
      this.prisma.userOrg.create({
        data: {
          userId,
          orgId: invitation.orgId,
          role: invitation.role,
        },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    return { status: 'accepted', orgId: invitation.orgId };
  }

  async listInvitations(orgId: string) {
    return this.prisma.invitation.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ─── Bulk Import ───────────────────────────────────────────

  /**
   * Bulk import members from CSV-like data.
   * Creates users if they don't exist and adds them to the org.
   */
  async importMembers(
    orgId: string,
    csvData: Array<{ email: string; name?: string; tier?: string }>,
  ) {
    const results = {
      created: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Resolve tier names to IDs
    const tiers = await this.prisma.membershipTier.findMany({
      where: { orgId, isActive: true },
    });
    const tierMap = new Map(tiers.map((t) => [t.name.toLowerCase(), t.id]));

    for (const row of csvData) {
      try {
        // Find or create the user
        let user = await this.prisma.user.findUnique({
          where: { email: row.email.toLowerCase().trim() },
        });

        if (!user) {
          user = await this.prisma.user.create({
            data: {
              email: row.email.toLowerCase().trim(),
              name: row.name?.trim() || null,
            },
          });
        }

        // Check if already a member
        const existing = await this.prisma.userOrg.findUnique({
          where: { userId_orgId: { userId: user.id, orgId } },
        });

        if (existing) {
          results.skipped++;
          continue;
        }

        // Resolve tier
        const tierId = row.tier
          ? tierMap.get(row.tier.toLowerCase().trim()) ?? null
          : null;

        await this.prisma.userOrg.create({
          data: {
            userId: user.id,
            orgId,
            role: 'MEMBER',
            tierId,
          },
        });

        results.created++;
      } catch (err) {
        results.errors.push(
          `Failed to import ${row.email}: ${(err as Error).message}`,
        );
      }
    }

    return results;
  }
}
