import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/**
 * Per-org configuration for both Belonging Support tools (PRD §4).
 *
 * Read far more often than written — every join, every scheduler pass, every
 * write request that has to ask whether the reading gate applies — so it is
 * resolved through one place that always returns a complete object. A caller
 * should never have to know whether a co-op has opened the settings screen.
 */
@Injectable()
export class BelongingSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The org's settings, creating the default row on first read.
   *
   * Both tools default off, so a co-op that has never heard of this feature
   * behaves exactly as it did before: no emails, no gates, nothing in the
   * member's way.
   */
  async forOrg(orgId: string) {
    const existing = await this.prisma.belongingSettings.findUnique({ where: { orgId } });
    if (existing) return existing;

    // `upsert` rather than `create`: two requests arriving together on a
    // co-op's first day would otherwise race and one would fail on the
    // unique index.
    return this.prisma.belongingSettings.upsert({
      where: { orgId },
      create: { orgId },
      update: {},
    });
  }

  async update(orgId: string, data: Record<string, unknown>) {
    await this.forOrg(orgId);

    if (data.buddyFallbackAdminId) {
      // The fallback must be a membership of *this* co-op. Without the check,
      // a stray id would hand a co-op's unmatched new members to a stranger.
      const member = await this.prisma.userOrg.findFirst({
        where: { id: data.buddyFallbackAdminId as string, orgId },
        select: { id: true },
      });
      if (!member) throw new NotFoundException('That member is not in this organization');
    }

    return this.prisma.belongingSettings.update({ where: { orgId }, data });
  }

  /**
   * Who an unmatched pairing falls to.
   *
   * Configured first; otherwise the longest-standing admin, which is the
   * closest thing MaybeOS has to "the community owner" and is at least a real
   * person rather than a null the pairing quietly stalls on.
   */
  async fallbackAdmin(orgId: string) {
    const settings = await this.forOrg(orgId);

    if (settings.buddyFallbackAdminId) {
      const chosen = await this.prisma.userOrg.findFirst({
        where: { id: settings.buddyFallbackAdminId, orgId },
        select: { id: true },
      });
      if (chosen) return chosen;
    }

    return this.prisma.userOrg.findFirst({
      where: { orgId, role: 'ADMIN' },
      orderBy: { memberSince: 'asc' },
      select: { id: true },
    });
  }
}
