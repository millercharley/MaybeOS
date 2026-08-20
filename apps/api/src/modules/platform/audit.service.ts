import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/**
 * Writing down what was done to a co-op, and by whom (PLT-01).
 *
 * `audit_logs` has been in the schema since the foundation and **had never
 * had a row written to it** — the model existed, nothing called it. That was
 * tolerable while every action was taken by somebody inside the co-op, who
 * could see the result. It stops being tolerable the moment MaybeOS itself
 * can suspend a co-op or waive its bill.
 *
 * Two rules:
 *
 * **A co-op can read its own log.** An admin who cannot tell that the
 * platform looked at, changed or suspended their co-op is being asked to take
 * it on trust. Anything MaybeOS does from the console appears in the co-op's
 * own audit view.
 *
 * **Writing is never allowed to fail the action.** A suspension that half
 * happened because the log write threw would be worse than a missing line.
 * Failures go to the process log and are swallowed — the same reasoning the
 * booking and waitlist emails use.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record something done to a co-op.
   *
   * `actorId` is the person, not the platform: "MaybeOS suspended you" is less
   * useful to a co-op than knowing which human did it and being able to ask
   * them why.
   */
  async record(input: {
    orgId: string;
    actorId?: string | null;
    action: string;
    entityType?: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          orgId: input.orgId,
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          metadata: (input.metadata ?? {}) as object,
        },
      });
    } catch (err) {
      this.logger.error(
        `Could not write audit log ${input.action} for org ${input.orgId}: ${String(err)}`,
      );
    }
  }

  /**
   * What has been done to this co-op, most recent first.
   *
   * Read by the co-op's own organisers, so the actor is resolved to a name —
   * a uuid tells nobody who suspended them.
   */
  async listForOrg(orgId: string, limit = 100) {
    const entries = await this.prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        actorId: true,
      },
    });

    const actorIds = [...new Set(entries.map((e) => e.actorId).filter(Boolean))] as string[];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    return entries.map(({ actorId, ...entry }) => ({
      ...entry,
      // Named, because "who did this to us" is the question an audit log
      // exists to answer.
      actor: actorId ? (byId.get(actorId) ?? null) : null,
    }));
  }
}

/** The actions MaybeOS itself can take, named once so they stay consistent. */
export const PLATFORM_ACTIONS = {
  ORG_SUSPENDED: 'platform.org.suspended',
  ORG_RESTORED: 'platform.org.restored',
  ORG_PLAN_CHANGED: 'platform.org.plan_changed',
  ORG_BILLING_WAIVED: 'platform.org.billing_waived',
  ORG_BILLING_UNWAIVED: 'platform.org.billing_unwaived',
} as const;
