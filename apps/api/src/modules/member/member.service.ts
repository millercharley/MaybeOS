import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { EmailService } from '../email/email.service';
import { StripeService } from '../stripe/stripe.service';
import { StorageService } from '../storage/storage.service';
import { BuddyService } from '../belonging/buddy.service';
import { ImportMemberRowDto, ImportAvatarsDto } from './dto/import-members.dto';
import { CreateTierDto } from './dto/create-tier.dto';
import { ContactViewer } from '../../common/access/contact-visibility';

/**
 * A member as another member may see them.
 *
 * Same co-op earns you a name, a face, a role and whatever the person chose
 * to write about themselves — not their email address, not the state of their
 * subscription, and not whether they agreed to be emailed. Organisers see the
 * whole row, because contacting and billing members is their job; see
 * `contact-visibility.ts`.
 *
 * Everyone sees their own record untouched.
 */
function toMemberView<
  T extends {
    userId: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    subscriptionStatus?: unknown;
    emailOptIn?: boolean | null;
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
    // Marketing consent is between a member and the co-op that asked. It sits
    // beside the email address it governs, and travels with it.
    emailOptIn: _optIn,
    user,
    ...rest
  } = member;
  const { email: _email, ...publicUser } = user;

  return { ...rest, user: publicUser };
}

/**
 * Profile links, filtered to the ones safe to render as links.
 *
 * http and https only. These are written into a page other members read, so
 * `javascript:` and `data:` are not a formatting quirk — they are script
 * execution in a reader's session. The web app filters again at render time;
 * this stops the bad ones being stored in the first place, which matters
 * because an import writes 116 of them without a human looking at each.
 */
export function safeLinks(links: string[]): string[] {
  const safe: string[] = [];
  for (const raw of links) {
    const value = raw.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') safe.push(value);
    } catch {
      // Not a URL at all. Dropped rather than stored as decoration.
    }
  }
  return safe;
}

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly stripeService: StripeService,
    private readonly storage: StorageService,
    private readonly buddies: BuddyService,
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

    // `isPublic` finally means something (FRM-01). It has been on `UserOrg`
    // since the beginning and nothing has ever read it, so a member who had
    // hidden themselves was listed anyway — a setting that lies is worse than
    // no setting.
    //
    // Organisers still see everyone, because running a co-op means knowing
    // who is in it; a member hiding from the directory is hiding from other
    // members, not from the people who admit and remove them.
    if (!viewer.privileged) {
      where.isPublic = true;
    }

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
              avatarPath: true,
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
            avatarPath: true,
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
  /**
   * A member editing their own entry in the directory (MEM-09).
   *
   * Keyed on the caller's own id rather than one from the URL, so there is no
   * shape of this request that edits somebody else. The directory could show a
   * biography long before anybody could write one — the column has been on
   * `UserOrg` since the schema was drawn and nothing ever set it.
   */
  async updateMyMembership(
    orgId: string,
    userId: string,
    dto: {
      bio?: string;
      tags?: string[];
      links?: string[];
      headline?: string;
      location?: string;
      emailOptIn?: boolean;
      isPublic?: boolean;
    },
  ) {
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('You are not a member of this organization');

    return this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: {
        ...(dto.bio !== undefined && { bio: dto.bio.trim() || null }),
        ...(dto.tags !== undefined && { tags: dto.tags.map((t) => t.trim()).filter(Boolean) }),
        ...(dto.links !== undefined && { links: safeLinks(dto.links) }),
        ...(dto.headline !== undefined && { headline: dto.headline.trim() || null }),
        // Whether other members can find them (FRM-01). Explicitly allowed
        // through rather than spread from the DTO, so adding a field to that
        // DTO never silently becomes a writable column.
        ...(dto.isPublic !== undefined && { isPublic: dto.isPublic }),
        ...(dto.location !== undefined && { location: dto.location.trim() || null }),
        ...(dto.emailOptIn !== undefined && { emailOptIn: dto.emailOptIn }),
      },
      select: {
        id: true, bio: true, tags: true, links: true,
        headline: true, location: true, emailOptIn: true,
      },
    });
  }

  /**
   * Change what somebody may do in their co-op (ORG-02).
   *
   * **A co-op must never be left with no organiser.** This route has existed
   * since the foundation with nothing calling it, so the danger was
   * theoretical; giving it a button in the members list makes it reachable,
   * and the first thing an admin can now do is demote the last admin — their
   * own co-op, locked out of its own settings, billing and member list, with
   * no way back that does not involve someone with database access.
   *
   * So the last ADMIN cannot be demoted, and the check counts ADMINs rather
   * than trusting the caller not to be the only one.
   */
  async updateMemberRole(orgId: string, userId: string, role: OrgRole) {
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { role: true },
    });

    if (!member) {
      throw new NotFoundException(
        `Member not found for user "${userId}" in org "${orgId}"`,
      );
    }

    if (member.role === 'ADMIN' && role !== 'ADMIN') {
      const admins = await this.prisma.userOrg.count({
        where: { orgId, role: 'ADMIN' },
      });

      if (admins <= 1) {
        throw new BadRequestException(
          'This is the co-op’s only organiser. Make somebody else an organiser first — otherwise nobody can reach settings, billing or the member list.',
        );
      }
    }

    return this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: { role },
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

    // Start looking for a buddy (BEL-01). A no-op unless the co-op has turned
    // the tool on, and deliberately not awaited into the join's success: a
    // Postmark outage must not stop somebody becoming a member.
    this.startBuddySearch(orgId, membership.id);

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

    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId: invitation.orgId } },
      select: { id: true },
    });
    if (membership) this.startBuddySearch(invitation.orgId, membership.id);

    // The tier travels back so the web app knows whether to hand off to
    // checkout. Returning only the org is what made the invitation path stop
    // short of payment.
    return {
      status: 'accepted',
      orgId: invitation.orgId,
      tierId: invitation.tierId,
    };
  }

  /**
   * Kick off a buddy search for somebody who has just joined (BEL-01).
   *
   * **Deliberately not awaited, and deliberately not on the bulk importer.**
   *
   * Not awaited, because a Postmark outage or a slow candidate query must not
   * be able to fail somebody's join. Being made a member is the thing that
   * matters; being introduced is a courtesy that can arrive a moment later,
   * and the scheduler picks up any pairing left seeking.
   *
   * Not on the importer, because MEM-06 brought 314 members across from
   * Circle in one call. Wiring this there would have asked 314 people to
   * welcome each other on the same afternoon — every one of them a real email
   * to a real person, and every one of them wrong. An import is a co-op
   * moving house, not 314 arrivals.
   */
  private startBuddySearch(orgId: string, membershipId: string): void {
    void this.buddies.onMemberJoined(orgId, membershipId).catch((err) => {
      this.logger.error(
        `Could not start a buddy search for ${membershipId}: ${(err as Error).message}`,
      );
    });
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
   * Bring an existing community in from somebody else's export (MEM-06).
   *
   * The rule throughout is that **an import never overwrites what MaybeOS
   * already knows**. A co-op's own organiser is usually row one of their own
   * export — Charley is, in MaybeItsFate's — and an import that helpfully
   * refreshed his profile would demote an OWNER to MEMBER and replace a
   * curated bio with whatever the old platform held. So an existing
   * membership is reported and left entirely alone, and an existing user
   * keeps their name and avatar.
   *
   * **Nothing is emailed.** Three hundred people receiving a surprise message
   * from a platform they have never heard of is the worst thing this feature
   * could do. Imported members have no password and are not marked verified;
   * they sign in by magic link whenever the co-op chooses to invite them.
   */
  async importMembers(orgId: string, rows: ImportMemberRowDto[]) {
    const results = {
      created: 0,
      /** Already a member here. Left untouched, not updated. */
      alreadyMembers: 0,
      /** Had a MaybeOS account already; joined to this co-op. */
      linkedExistingUsers: 0,
      /** Imported with an avatar still to copy across. */
      avatarsPending: 0,
      errors: [] as Array<{ email: string; reason: string }>,
    };

    for (const row of rows) {
      const email = row.email.toLowerCase().trim();

      try {
        let user = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true, avatarUrl: true },
        });

        if (user) {
          results.linkedExistingUsers++;
        } else {
          user = await this.prisma.user.create({
            data: {
              email,
              name: row.name?.trim() || null,
              avatarUrl: row.avatarUrl?.trim() || null,
              // No password and unverified: this account was made *for*
              // somebody rather than *by* them, and it must not look like a
              // completed signup until they complete one.
            },
            select: { id: true, avatarUrl: true },
          });
        }

        const existing = await this.prisma.userOrg.findUnique({
          where: { userId_orgId: { userId: user.id, orgId } },
          select: { id: true },
        });

        if (existing) {
          results.alreadyMembers++;
          continue;
        }

        await this.prisma.userOrg.create({
          data: {
            userId: user.id,
            orgId,
            role: 'MEMBER',
            // The date they actually joined the community, where the export
            // knew it. Falls back to the column default, which is now.
            ...(row.joinedAt && { memberSince: new Date(row.joinedAt) }),
            bio: row.bio?.trim() || null,
            headline: row.headline?.trim() || null,
            location: row.location?.trim() || null,
            tags: (row.tags ?? []).map((t) => t.trim()).filter(Boolean),
            links: safeLinks(row.links ?? []),
            // Only when the export actually said. Absent stays null — never
            // asked — rather than becoming a refusal nobody made.
            ...(row.emailOptIn !== undefined && { emailOptIn: row.emailOptIn }),
          },
        });

        results.created++;
        if (user.avatarUrl) results.avatarsPending++;
      } catch (err) {
        results.errors.push({ email, reason: (err as Error).message });
      }
    }

    return results;
  }

  /**
   * Copy imported avatars into MaybeOS's own storage, a few at a time.
   *
   * Separate from the import itself because each avatar is an outbound HTTP
   * fetch, and 200 of them do not fit in one Lambda's wall clock. The client
   * walks the roster with a cursor and can stop and resume; a member whose
   * avatar cannot be fetched is passed over rather than retried forever.
   *
   * Worth doing at all because an imported avatar URL is a link into the
   * platform the co-op is leaving. It is signed, it is tied to that account,
   * and it dies with the subscription — so a roster that merely *stored* the
   * URL would quietly turn into 200 broken images.
   */
  async importAvatars(orgId: string, dto: ImportAvatarsDto) {
    const limit = dto.limit ?? 8;

    const memberships = await this.prisma.userOrg.findMany({
      where: {
        orgId,
        ...(dto.after && { id: { gt: dto.after } }),
        user: { avatarPath: null, avatarUrl: { not: null } },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, user: { select: { id: true, avatarUrl: true } } },
    });

    let imported = 0;
    let failed = 0;

    for (const membership of memberships) {
      const path = await this.storage.importAvatarFromUrl(
        membership.user.id,
        membership.user.avatarUrl as string,
      );

      if (path) {
        await this.prisma.user.update({
          where: { id: membership.user.id },
          data: { avatarPath: path },
        });
        imported++;
      } else {
        failed++;
      }
    }

    const lastId = memberships.at(-1)?.id ?? dto.after ?? null;

    // How many remain *after* this cursor, so a run that fails every fetch
    // still reports progress and still terminates.
    const remaining = lastId
      ? await this.prisma.userOrg.count({
          where: { orgId, id: { gt: lastId }, user: { avatarPath: null, avatarUrl: { not: null } } },
        })
      : 0;

    return {
      imported,
      failed,
      remaining,
      lastId,
      done: memberships.length < limit,
    };
  }
}
