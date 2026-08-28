import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { MaybeOsPlan } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { AuditService, PLATFORM_ACTIONS } from './audit.service';
import { PLATFORM_FEE_CENTS } from '../stripe/ticket-pricing';
import { StorageHealthIndicator } from '../health/storage.health';

/**
 * The co-ops running on MaybeOS, for whoever runs MaybeOS (PLT-01).
 *
 * **This module answers about co-ops, not about members.** Charley's rule is
 * that member PII stays private, and that is the design rather than a caveat
 * on it: nothing here returns a member's name, email, demographics or
 * messages. A co-op's *contact* is the one organiser somebody would write to,
 * and that is the deliberate exception — a platform with no way to reach the
 * person running a co-op cannot support it.
 *
 * Everything that changes a co-op is written to that co-op's own audit log,
 * where its organisers can read it. A support visit that leaves no trace is
 * indistinguishable from one that never happened.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageHealthIndicator,
  ) {}

  /**
   * Every co-op, newest first.
   *
   * Newest first because the list doubles as the signup feed: SCL-02 shipped
   * self-serve signup, so anybody with an email can create a co-op in the
   * production database and **nobody is notified**. This is the only place
   * that would show it.
   */
  async listOrgs() {
    const orgs = await this.prisma.organization.findMany({
      // MaybeOS's own forum is not a co-op paying for MaybeOS (FRM-01).
      // Counting it would make every figure on this screen one out, and put
      // a row here that nobody can suspend or invoice.
      where: { isPlatformForum: false },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        customDomain: true,
        plan: true,
        planStatus: true,
        billingWaived: true,
        billingWaivedReason: true,
        suspendedAt: true,
        suspendedReason: true,
        createdAt: true,
        // Whether Stripe will actually take money. `stripeAccountId` set with
        // `stripeChargesEnabled` false is onboarding started and abandoned —
        // a co-op that believes it is selling tickets and is not, which is
        // invisible everywhere else in the product.
        stripeChargesEnabled: true,
        _count: {
          select: { users: true, events: true, rooms: true },
        },
      },
    });

    // The one organiser somebody would write to. Not the member list — one
    // contact, and only for co-ops that have one.
    const contacts = await this.prisma.userOrg.findMany({
      where: { orgId: { in: orgs.map((o) => o.id) }, role: 'ADMIN' },
      orderBy: { memberSince: 'asc' },
      select: { orgId: true, user: { select: { name: true, email: true } } },
    });
    const firstAdmin = new Map<string, { name: string | null; email: string }>();
    for (const c of contacts) {
      if (!firstAdmin.has(c.orgId)) firstAdmin.set(c.orgId, c.user);
    }

    return orgs.map(({ _count, ...org }) => ({
      ...org,
      url: `https://maybeos.org/portal/${org.slug}`,
      memberCount: _count.users,
      eventCount: _count.events,
      roomCount: _count.rooms,
      /** What its buyers pay per transaction, which is what the plan is for. */
      transactionFeeCents: PLATFORM_FEE_CENTS[org.plan],
      contact: firstAdmin.get(org.id) ?? null,
      /** A co-op with no organiser cannot be reached, or reach its own settings. */
      hasNoAdmin: !firstAdmin.has(org.id),
      /** Started Stripe onboarding and never finished it. */
      stripeHalfConnected: !org.stripeChargesEnabled,
    }));
  }

  /**
   * Stop a co-op being used, without touching what it holds.
   *
   * Suspension is not deletion, and this deliberately does not decide what
   * happens to a suspended co-op's data — that decision has not been taken,
   * and nothing here has to be undone whichever way it goes.
   */
  async suspend(orgId: string, actorId: string, reason: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, suspendedAt: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (org.suspendedAt) throw new BadRequestException('That co-op is already suspended');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: new Date(), suspendedReason: reason.trim() },
      select: { id: true, name: true, suspendedAt: true, suspendedReason: true },
    });

    // Written where the co-op's own organisers can read it. They are about to
    // be locked out; being told why, and by whom, is the least of it.
    await this.audit.record({
      orgId,
      actorId,
      action: PLATFORM_ACTIONS.ORG_SUSPENDED,
      entityType: 'organization',
      entityId: orgId,
      metadata: { reason: reason.trim() },
    });

    return updated;
  }

  async restore(orgId: string, actorId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, suspendedAt: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.suspendedAt) throw new BadRequestException('That co-op is not suspended');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: { suspendedAt: null, suspendedReason: null },
      select: { id: true, name: true, suspendedAt: true },
    });

    await this.audit.record({
      orgId,
      actorId,
      action: PLATFORM_ACTIONS.ORG_RESTORED,
      entityType: 'organization',
      entityId: orgId,
    });

    return updated;
  }

  /**
   * Put a co-op on a plan, or stop charging it for the one it is on.
   *
   * These are two switches on purpose. `plan` decides what a co-op *gets* and
   * what its buyers pay per ticket; `billingWaived` decides whether MaybeOS
   * charges it. Comping a co-op by moving it to FREE would triple its
   * members' ticket fees, which is the opposite of a gift.
   */
  async setPlan(
    orgId: string,
    actorId: string,
    input: { plan?: MaybeOsPlan; billingWaived?: boolean; reason?: string },
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, plan: true, billingWaived: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(input.plan !== undefined && { plan: input.plan }),
        ...(input.billingWaived !== undefined && {
          billingWaived: input.billingWaived,
          billingWaivedReason: input.billingWaived ? (input.reason?.trim() || null) : null,
        }),
      },
      select: { id: true, plan: true, billingWaived: true, billingWaivedReason: true },
    });

    if (input.plan !== undefined && input.plan !== org.plan) {
      await this.audit.record({
        orgId,
        actorId,
        action: PLATFORM_ACTIONS.ORG_PLAN_CHANGED,
        entityType: 'organization',
        entityId: orgId,
        // Both figures, because the change a co-op actually feels is the
        // per-transaction one and it is not in the plan's name.
        metadata: {
          from: org.plan,
          to: input.plan,
          transactionFeeFrom: PLATFORM_FEE_CENTS[org.plan],
          transactionFeeTo: PLATFORM_FEE_CENTS[input.plan],
        },
      });
    }

    if (input.billingWaived !== undefined && input.billingWaived !== org.billingWaived) {
      await this.audit.record({
        orgId,
        actorId,
        action: input.billingWaived
          ? PLATFORM_ACTIONS.ORG_BILLING_WAIVED
          : PLATFORM_ACTIONS.ORG_BILLING_UNWAIVED,
        entityType: 'organization',
        entityId: orgId,
        metadata: { reason: input.reason?.trim() ?? null },
      });
    }

    return updated;
  }

  /**
   * What the platform looks like in one number each.
   *
   * Counts only. A number of co-ops is not a member's business and a member
   * is not in this at all.
   */
  async summary() {
    const [orgs, suspended, waived, chargeable, members] = await Promise.all([
      this.prisma.organization.count(),
      this.prisma.organization.count({ where: { suspendedAt: { not: null } } }),
      this.prisma.organization.count({ where: { billingWaived: true } }),
      this.prisma.organization.count({ where: { stripeChargesEnabled: true } }),
      this.prisma.userOrg.count(),
    ]);

    const byPlan = await this.prisma.organization.groupBy({
      by: ['plan'],
      _count: { _all: true },
    });

    // Storage on the console, because a rejected key is MaybeOS's problem and
    // not any co-op's — and because it fails *silently* everywhere else by
    // design (OPS-29): attachments stop appearing, avatars never resolve, and
    // the first report would come from a member.
    const storage = await this.storage.isHealthy('storage');

    return {
      orgs,
      suspended,
      billingWaived: waived,
      storage: storage.storage as unknown as {
        configured: boolean;
        reachable: boolean;
        httpStatus?: number;
        buckets?: string[];
      },
      /** Co-ops that can actually take money — the rest cannot sell a ticket. */
      canTakePayments: chargeable,
      memberships: members,
      byPlan: Object.fromEntries(byPlan.map((p) => [p.plan, p._count._all])),
    };
  }
}
