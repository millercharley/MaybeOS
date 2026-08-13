import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { StripeService } from '../stripe/stripe.service';
import { CreateTierDto } from './dto/create-tier.dto';
import { ContactViewer } from '../../common/access/contact-visibility';

/**
 * A member as another member may see them.
 *
 * Same co-op earns you a name, a face, a role and whatever the person chose
 * to write about themselves — not their email address, and not the state of
 * their subscription. Organisers see the whole row, because contacting and
 * billing members is their job; see `contact-visibility.ts`.
 *
 * Everyone sees their own record untouched.
 */
function toMemberView<
  T extends {
    userId: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    subscriptionStatus?: unknown;
    user: { email?: string };
  },
>(member: T, viewer: ContactViewer) {
  if (viewer.privileged || member.userId === viewer.userId) {
    return member;
  }

  const {
    stripeCustomerId: _customer,
    stripeSubscriptionId: _subscription,
    subscriptionStatus: _status,
    user,
    ...rest
  } = member;
  const { email: _email, ...publicUser } = user;

  return { ...rest, user: publicUser };
}

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly stripeService: StripeService,
  ) {}

  // ─── Members ────────────────────────────────────────────────

  /**
   * Paginated list of members for an org. Organisers may search by name or
   * email; everyone else, by name only.
   */
  async listMembers(
    orgId: string,
    viewer: ContactViewer,
    page: number = 1,
    perPage: number = 20,
    search?: string,
  ) {
    const skip = (page - 1) * perPage;

    const where: any = { orgId };

    if (search) {
      // Matching on email would answer "is this address a member here?" even
      // with the address itself redacted from the response — a membership
      // oracle for anyone with a list of emails to test. Organisers keep it
      // because looking a member up by the address they wrote in is the
      // normal way to find them.
      where.user = viewer.privileged
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : { name: { contains: search, mode: 'insensitive' } };
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
      data: data.map((member) => toMemberView(member, viewer)),
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
  async getMember(orgId: string, userId: string, viewer: ContactViewer) {
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

    return toMemberView(member, viewer);
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

  /**
   * A logged-in user joins an org from its public page.
   *
   * Until now nothing could create a UserOrg except founding an org or
   * accepting an invitation, so the public "Join as X" button led people into
   * creating their *own* organisation instead — observed in production with a
   * real sign-up (D-020).
   *
   * The membership is created immediately with `subscriptionStatus: NONE`
   * rather than waiting for payment. An abandoned checkout then leaves a
   * resumable record instead of a dead end, and admins can see who has joined
   * but not yet paid. Charley's call.
   */
  async joinOrg(orgId: string, userId: string, tierId?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, allowPublicJoin: true },
    });

    if (!org) {
      throw new NotFoundException('Organization not found');
    }

    const existing = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
    });

    // Idempotent, and checked *before* the public-join gate. Someone who is
    // already a member is not joining, so that gate has nothing to guard —
    // and checking it first told an invited member of an invitation-only
    // co-op to "ask an organiser for an invite", which they had just used
    // (MEM-04). It also blocked anyone who abandoned checkout and came back.
    if (existing) {
      return { membership: existing, alreadyMember: true };
    }

    // Invitation-only orgs are not merely hidden in the UI — the endpoint
    // refuses, or hiding the page would be decoration. This still guards
    // every actual join: only an existing membership skips it, and one can
    // only exist because an invitation or an open door created it.
    if (!org.allowPublicJoin) {
      throw new ForbiddenException(
        `${org.name} is invitation only. Ask an organiser for an invite.`,
      );
    }

    if (tierId) {
      const tier = await this.prisma.membershipTier.findFirst({
        where: { id: tierId, orgId, isActive: true },
      });
      if (!tier) {
        throw new NotFoundException('That membership tier is not available');
      }
    }

    const membership = await this.prisma.userOrg.create({
      data: {
        userId,
        orgId,
        tierId: tierId ?? null,
        role: 'MEMBER',
        subscriptionStatus: 'NONE',
      },
    });

    this.logger.log(`User ${userId} joined org ${orgId} (tier ${tierId ?? 'none'})`);

    return { membership, alreadyMember: false };
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

    const tier = await this.prisma.membershipTier.create({
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

    // Provision the matching Stripe Product and Price.
    //
    // Without this a tier can never be bought: createCheckoutSession needs
    // stripePriceIdMonthly (or stripeProductId for pay-what-you-can) and
    // nothing else ever sets them. createStripePricesForTier existed but was
    // dead code — no caller anywhere — so every tier ever created was
    // unpurchasable.
    //
    // Deliberately non-fatal. Local dev and CI run without Stripe keys, and a
    // Stripe outage shouldn't stop an admin defining tiers. The tier is simply
    // not purchasable until provisioning succeeds; `backfillStripeForTier`
    // retries it.
    await this.provisionStripeForTier(tier);

    // tenant-scoping-exempt: re-reading the tier this method just created in
    // `orgId`, to pick up the Stripe ids provisioning wrote.
    return this.prisma.membershipTier.findUnique({ where: { id: tier.id } });
  }

  /**
   * Create the Stripe Product/Price for a tier and store the ids.
   * Safe to call on a tier that already has them — it skips.
   */
  async provisionStripeForTier(tier: {
    id: string;
    name: string;
    description?: string | null;
    priceMonthly: number;
    orgId: string;
    stripePriceIdMonthly?: string | null;
  }): Promise<boolean> {
    if (tier.stripePriceIdMonthly) return true;

    try {
      const priceId = await this.stripeService.createStripePricesForTier({
        id: tier.id,
        name: tier.name,
        description: tier.description ?? undefined,
        priceMonthly: tier.priceMonthly,
        orgId: tier.orgId,
      });

      await this.prisma.membershipTier.update({
        where: { id: tier.id },
        data: { stripePriceIdMonthly: priceId },
      });

      return true;
    } catch (err) {
      this.logger.warn(
        `Could not provision Stripe objects for tier ${tier.id} (${tier.name}): ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          'The tier exists but cannot be purchased until this succeeds.',
      );
      return false;
    }
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
   * Tiers for the admin dashboard: includes deactivated ones, and the number
   * of members currently paying for each.
   *
   * Deliberately separate from `listTiers`, which is public and unauthenticated
   * so the join page can render. Putting these counts there would publish every
   * co-op's per-tier membership numbers to anyone who asked — for a small
   * organization that is genuinely sensitive.
   *
   * `activeSubscribers` is what decides whether the admin UI shows the
   * grandfathering option on a price change: with nobody on the tier there is
   * no decision to make, so the question shouldn't be asked.
   */
  async listTiersForAdmin(orgId: string) {
    const tiers = await this.prisma.membershipTier.findMany({
      where: { orgId },
      orderBy: { sortOrder: 'asc' },
    });

    const counts = await this.prisma.userOrg.groupBy({
      by: ['tierId'],
      where: {
        orgId,
        tierId: { not: null },
        subscriptionStatus: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] },
      },
      _count: { _all: true },
    });

    const byTier = new Map(counts.map((c) => [c.tierId, c._count._all]));

    return tiers.map((tier) => ({
      ...tier,
      activeSubscribers: byTier.get(tier.id) ?? 0,
    }));
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

    const { applyToExistingMembers, ...fields } = dto as Partial<CreateTierDto> & {
      applyToExistingMembers?: boolean;
    };

    // A price change has to reach Stripe, and Stripe Prices are immutable.
    // Previously this method wrote the new amount to the database and stopped
    // there, so MaybeOS showed the new price while Stripe kept charging the
    // old one indefinitely — including for members who signed up afterwards.
    //
    // Pay-what-you-can tiers are exempt: their Price is built per member at
    // checkout from the amount that member chose, so there is no shared Price
    // to replace. Changing `minPrice` only affects future checkouts.
    const priceChanged =
      typeof fields.priceMonthly === 'number' &&
      fields.priceMonthly !== tier.priceMonthly &&
      !tier.isPayWhatYouCan;

    let stripePriceIdMonthly = tier.stripePriceIdMonthly;
    let migrated = 0;

    if (priceChanged) {
      const result = await this.stripeService.repriceTier(
        tier,
        fields.priceMonthly as number,
        applyToExistingMembers ?? false,
      );
      stripePriceIdMonthly = result.priceId;
      migrated = result.migrated;

      // The org's Billing Portal configuration pins specific price ids, so it
      // now points at the Price we just archived — members would be offered a
      // tier they can no longer switch to. Clearing the cached id makes
      // ensurePortalConfiguration rebuild it on the next portal visit.
      await this.prisma.organization.update({
        where: { id: orgId },
        data: { stripePortalConfigId: null },
      });
    }

    const updated = await this.prisma.membershipTier.update({
      where: { id: tierId },
      data: {
        ...fields,
        ...(priceChanged ? { stripePriceIdMonthly } : {}),
      },
    });

    // Tell the caller what actually happened to people's money, so the admin
    // UI can say "12 members move to the new price at their next renewal"
    // rather than a bare success.
    return {
      ...updated,
      repriced: priceChanged,
      migratedSubscribers: migrated,
      grandfathered: priceChanged && !(applyToExistingMembers ?? false),
    };
  }

  // ─── Invitations ────────────────────────────────────────────

  async inviteMember(
    orgId: string,
    email: string,
    role: string,
    invitedByUserId: string,
    tierId?: string,
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
        // Verified against this org before it is stored: an invitation
        // pointing at another co-op's tier would fail at checkout, long after
        // the admin who sent it has moved on.
        tierId: tierId
          ? (
              await this.prisma.membershipTier.findFirst({
                where: { id: tierId, orgId, isActive: true },
                select: { id: true },
              })
            )?.id
          : null,
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
      include: {
        org: { select: { id: true, name: true, slug: true, logoUrl: true, brandColor: true } },
        // What joining costs, said before they accept rather than at Stripe.
        // Deliberately not the whole tier row: this endpoint is public, and a
        // token is a guessable-length string somebody may have been forwarded.
        tier: { select: { id: true, name: true, priceMonthly: true, priceYearly: true } },
      },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('This invitation has already been accepted');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('This invitation has expired');

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      org: invitation.org,
      tier: invitation.tier,
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
      return { status: 'already_member', orgId: invitation.orgId, tierId: null };
    }

    await this.prisma.$transaction([
      this.prisma.userOrg.create({
        data: {
          userId,
          orgId: invitation.orgId,
          role: invitation.role,
          // The tier the invitation named (MEM-04). Without this an invited
          // member joined with no tier and no dues, while somebody arriving
          // through the public page paid — one co-op, two prices, decided by
          // which door you came through.
          tierId: invitation.tierId,
        },
      }),
      this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    // The tier travels back so the web app knows whether to hand off to
    // checkout. Returning only the org is what made the invitation path stop
    // short of payment.
    return {
      status: 'accepted',
      orgId: invitation.orgId,
      tierId: invitation.tierId,
    };
  }

  async listInvitations(orgId: string) {
    return this.prisma.invitation.findMany({
      where: { orgId, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async resendInvite(orgId: string, inviteId: string, resendByUserId: string) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: inviteId, orgId },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('This invitation has already been accepted');

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const resender = await this.prisma.user.findUnique({ where: { id: resendByUserId } });

    const updated = await this.prisma.invitation.update({
      where: { id: inviteId },
      data: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    });

    const webUrl = this.configService.get<string>('WEB_URL');
    const inviteUrl = `${webUrl}/invite?token=${updated.token}`;

    await this.emailService.sendInvite(
      invitation.email,
      org.name,
      inviteUrl,
      resender?.name || undefined,
    );

    return { id: updated.id, email: updated.email, status: 'resent' };
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
