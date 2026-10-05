import { randomUUID } from 'crypto';
import { assertMemberRoom, countsAsMember, memberRoom } from './member-capacity';
import { tierIdFor } from './import-tier';
import { manualStatusRefusal, type ManualStatus } from './manual-status';
import { pageWindow } from './page-window';
import { FREE_PLAN_MEMBER_LIMIT } from '../stripe/dues-pricing';
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { normaliseHandle } from '../social/social-caption';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { PUBLIC_TIER_SELECT } from './tier-view';
import { EmailService } from '../email/email.service';
import {
  BelongingEmailKindName,
  DEFAULT_TEMPLATES,
  renderTemplate,
} from '../belonging/belonging-emails';
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
    doorPin?: string | null;
    socialShareAllowed?: boolean | null;
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
    // The door code (DOR-01). Named here and not merely omitted at the
    // client, because the members list lifts that omission so organisers can
    // see codes — and `...rest` would then carry every member's code to every
    // member who opened the directory. The omission is the seatbelt; this is
    // the one place the belt is off.
    doorPin: _doorPin,
    // Whether an admin has stopped this member sharing to the co-op's
    // Facebook and Instagram (SOC-01). A moderation decision, not a profile.
    socialShareAllowed: _socialShare,
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
    // Clamped, not trusted: these arrive from a query string (MEM-22).
    const window = pageWindow(page, perPage);

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
        skip: window.skip,
        take: window.take,
        orderBy: { memberSince: 'desc' },
        // Lifts the client-level omission on the door code, for organisers
        // (Charley's call: admins can see them, which makes helping somebody
        // locked out a two-second job). `toMemberView` strips it again for
        // anybody who is not an organiser looking at somebody else.
        omit: { doorPin: false },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
              avatarPath: true,
              // When they last got in (MEM-24). An organiser looking at a
              // roster after a migration is asking who has actually arrived,
              // and until now nothing could answer it.
              lastLoginAt: true,
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
        page: window.page,
        perPage: window.perPage,
        totalPages: Math.ceil(total / window.perPage),
      },
    };
  }

  /**
   * One member, at random, to introduce to another (MEM-12).
   *
   * Charley: feature a member on the dashboard, a different one every visit,
   * as a way of introducing members to each other. A co-op of forty people
   * where everybody knows six of them is the problem this is aimed at.
   *
   * Four rules, and each one is a way the obvious version gets it wrong:
   *
   * - **Never the viewer.** Being introduced to yourself is not an
   *   introduction, and "send them a message" would open a conversation with
   *   yourself.
   * - **`isPublic` is honoured for everybody, organisers included.** The
   *   directory lets organisers see hidden members because running a co-op
   *   means knowing who is in it. This is not that: it is a "meet this
   *   person" card, and putting somebody who hid themselves on the front of
   *   another member's dashboard is the exact thing they opted out of. Role
   *   does not change it.
   * - **Members, not guests.** The same three roles the membership count
   *   uses, so the co-op the spotlight draws from is the co-op the dashboard
   *   says exists.
   * - **Uniform, not weighted.** It would be easy to prefer members who have
   *   written a headline, and it would quietly bury everybody who has not —
   *   who are exactly the people nobody has met yet.
   *
   * Counted and offset rather than `ORDER BY random()`: it stays inside
   * Prisma, uses the org index, and a co-op is tens or hundreds of rows, not
   * millions. If somebody leaves between the count and the read the offset can
   * fall off the end, which returns null and shows no card — a missing card is
   * a fine outcome for a race that resolves itself on the next page load.
   */
  async spotlight(orgId: string, viewerUserId: string) {
    const where = {
      orgId,
      isPublic: true,
      role: { in: ['ADMIN', 'STAFF', 'MEMBER'] as OrgRole[] },
      userId: { not: viewerUserId },
    };

    const eligible = await this.prisma.userOrg.count({ where });
    if (eligible === 0) return null;

    const member = await this.prisma.userOrg.findFirst({
      where,
      skip: Math.floor(Math.random() * eligible),
      // A stable order under the random offset. Without one Postgres may
      // return rows in whatever order it likes, which would make the offset
      // pick from a shuffled deck — not wrong, but not evenly random either.
      orderBy: { memberSince: 'asc' },
      select: {
        id: true,
        userId: true,
        headline: true,
        bio: true,
        location: true,
        tags: true,
        memberSince: true,
        // Deliberately no email: members do not get each other's contact
        // details, and a spotlight is the last place to start.
        user: { select: { id: true, name: true, avatarUrl: true, avatarPath: true } },
      },
    });

    return member;
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
      instagramHandle?: string | null;
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
        ...(dto.instagramHandle !== undefined && { instagramHandle: normaliseHandle(dto.instagramHandle) }),
      },
      select: {
        id: true, bio: true, tags: true, links: true,
        headline: true, location: true, emailOptIn: true, instagramHandle: true,
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
  /**
   * Set a membership's status by hand (MEM-23).
   *
   * Only where Stripe is not already answering. A manual status on a
   * membership Stripe bills is overwritten by the next webhook — so it would
   * tell the truth until it silently stopped, and in between it is the screen
   * an organiser trusts.
   */
  async setMemberStatus(orgId: string, userId: string, status: ManualStatus) {
    const member = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { stripeSubscriptionId: true },
    });

    if (!member) {
      throw new NotFoundException(
        `Member not found for user "${userId}" in org "${orgId}"`,
      );
    }

    const refusal = manualStatusRefusal(member);
    if (refusal) throw new BadRequestException(refusal);

    const updated = await this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: {
        subscriptionStatus: status,
        // Set by hand, so there is no period and nothing is ending. Leaving
        // a stale date behind would have the member's own page announce a
        // renewal that is not going to happen.
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
      },
      select: { userId: true, subscriptionStatus: true },
    });

    return { updated: true, subscriptionStatus: updated.subscriptionStatus };
  }

  /**
   * Hand somebody back the events and rooms they ran before (CAL-03).
   *
   * A co-op's calendar import keeps the Google organiser's address on any
   * event or reservation it could not match to a member. Somebody joining —
   * or rejoining, which is the case Charley asked about — picks those up the
   * moment they have a membership, without an organiser remembering to go
   * looking.
   *
   * Idempotent and safe to call on every join: it only ever touches rows that
   * are still waiting on this exact address, and clears the address as it
   * goes, so a second run finds nothing.
   *
   * Failure is not allowed to stop a join. Somebody who cannot get into the
   * co-op because a three-year-old event could not be relinked is a worse
   * outcome than an event that stays unattached until the next time.
   */
  async claimPastHosting(orgId: string, userId: string, email: string) {
    const address = email.trim().toLowerCase();
    if (!address) return { events: 0, bookings: 0 };

    try {
      const [events, bookings] = await this.prisma.$transaction([
        this.prisma.event.updateMany({
          where: { orgId, hostId: null, hostEmail: address },
          data: { hostId: userId, hostEmail: null, hostName: null },
        }),
        this.prisma.booking.updateMany({
          where: { bookedForEmail: address, room: { orgId } },
          data: { userId, bookedForEmail: null, bookedForName: null },
        }),
      ]);

      if (events.count || bookings.count) {
        this.logger.log(
          `Reattached ${events.count} events and ${bookings.count} bookings to ${userId} in org ${orgId}`,
        );
      }

      return { events: events.count, bookings: bookings.count };
    } catch (error) {
      this.logger.error(
        `Could not reattach past hosting for ${userId} in org ${orgId}: ${(error as Error).message}`,
      );
      return { events: 0, bookings: 0 };
    }
  }

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

    // A guest made a member takes a place under the Free plan's limit (PAY-09).
    if (!countsAsMember(member.role) && countsAsMember(role)) {
      await assertMemberRoom(this.prisma, orgId, 1, 'organiser');
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

    if (countsAsMember(role)) await assertMemberRoom(this.prisma, orgId, 1, 'organiser');

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
  /**
   * Remove somebody from the co-op, and stop their dues (MEM-20).
   *
   * **The dues are cancelled first, and the membership is only deleted if
   * that worked.** Until this, removing a member deleted the row and said
   * nothing to Stripe: their subscription carried on billing them, on the
   * co-op's own account, for a co-op they were no longer in — and the row
   * that held the subscription id was gone, so nothing in MaybeOS could even
   * find it again. The failure surfaces months later as a member asking why
   * they are still paying.
   *
   * In this order for the same reason. A delete that succeeds after a failed
   * cancel is the unrecoverable version; a cancel that succeeds before a
   * failed delete leaves a member who is still in the co-op and not being
   * charged, which an organiser can see and fix.
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

    let duesCancelled = false;

    if (member.stripeSubscriptionId && member.subscriptionStatus !== 'CANCELED') {
      try {
        duesCancelled = await this.stripeService.cancelDuesNow(
          member.stripeSubscriptionId,
          member.stripeDuesAccountId,
        );
      } catch (error) {
        // Deliberately fatal. Removing them anyway would charge somebody for
        // a co-op they have left, and lose the only record of which
        // subscription to stop.
        throw new BadRequestException(
          'Their dues could not be cancelled, so nothing was changed. ' +
            'Check the subscription in Stripe and try again — removing them now would keep charging them.',
        );
      }
    }

    await this.prisma.userOrg.delete({
      where: { userId_orgId: { userId, orgId } },
    });

    return { removed: true, duesCancelled };
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

    await assertMemberRoom(this.prisma, orgId, 1, 'joiner');

    const membership = await this.prisma.userOrg.create({
      data: {
        userId,
        orgId,
        tierId: tierId ?? null,
        role: 'MEMBER',
        subscriptionStatus: 'NONE',
      },
    });

    // Anything the co-op's calendar import left waiting under this address
    // (CAL-03) — the rejoining case Charley asked for.
    const joiner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (joiner?.email) await this.claimPastHosting(orgId, userId, joiner.email);

    this.logger.log(`User ${userId} joined org ${orgId} (tier ${tierId ?? 'none'})`);

    // Start looking for a buddy (BEL-01). A no-op unless the co-op has turned
    // the tool on, and deliberately not awaited into the join's success: a
    // Postmark outage must not stop somebody becoming a member.
    this.startBuddySearch(orgId, membership.id);
    this.sendWelcome(orgId, userId);

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
        // A one-time charge on joining (PAY-10). Zero is no fee, which is
        // every tier until an admin sets one.
        initiationFeeCents: dto.initiationFeeCents ?? 0,
        benefits: dto.benefits ?? [],
        ...this.serviceExpectation(dto),
        // The badge, if the form carried one (MEM-16). Whitelisted like every
        // other field here rather than spread, so a new column is a decision
        // rather than an accident.
        highlightLabel: this.normalizeHighlight(dto),
        sortOrder: nextOrder,
      },
    });

    // At most one highlighted tier per co-op, same as on edit.
    if (tier.highlightLabel) {
      await this.prisma.membershipTier.updateMany({
        where: { orgId, id: { not: tier.id }, highlightLabel: { not: null } },
        data: { highlightLabel: null },
      });
    }

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
   * Create the Stripe product and price for a tier on the co-op's connected
   * account, and store the ids (PAY-09). Safe to call on a tier that already
   * has them there — it skips.
   *
   * A co-op that has not connected Stripe yet gets its tier without Stripe
   * objects; checkout creates them on the connected account once there is
   * one. That is the normal state for a new community, not a failure.
   */
  async provisionStripeForTier(tier: {
    id: string;
    name: string;
    description?: string | null;
    priceMonthly: number;
    orgId: string;
    isPayWhatYouCan?: boolean;
    stripePriceIdMonthly?: string | null;
    stripeProductId?: string | null;
    stripeDuesAccountId?: string | null;
  }): Promise<boolean> {
    if (tier.stripeDuesAccountId && tier.stripeProductId) return true;

    try {
      const created = await this.stripeService.provisionTierOnConnectedAccount(tier);
      if (!created) return false;

      await this.prisma.membershipTier.update({
        where: { id: tier.id },
        data: {
          stripeProductId: created.productId,
          stripePriceIdMonthly: created.priceId,
          stripeDuesAccountId: created.accountId,
        },
      });

      return true;
    } catch (err) {
      this.logger.warn(
        `Could not provision Stripe objects for tier ${tier.id} (${tier.name}): ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          'Checkout will create them on the connected account instead.',
      );
      return false;
    }
  }

  /**
   * Active tiers for an org, in the order the admin put them (MEM-13).
   *
   * Public and unauthenticated: a co-op's join page renders for strangers.
   * That is why the columns are chosen rather than the row returned whole —
   * see `PUBLIC_TIER_SELECT`.
   */
  async listTiers(orgId: string) {
    return this.prisma.membershipTier.findMany({
      where: { orgId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: PUBLIC_TIER_SELECT,
    });
  }

  /**
   * Put the tiers in the order an admin chose (MEM-13).
   *
   * `sortOrder` has been on this model since it was drawn and every list has
   * read it — but nothing could ever *write* it except tier creation, which
   * appends. So a co-op's dues page showed its tiers in the order somebody
   * happened to add them, with the $19.50 tier above the $4 one and the free
   * one at the bottom, and there was no way to say otherwise.
   *
   * The whole order in one transaction, as with channels, onboarding steps and
   * links: moving one tier renumbers its neighbours anyway, and two admins
   * doing that at once leaves two tiers claiming one position. Ids belonging
   * to another co-op are filtered out by the scoped `updateMany` rather than
   * trusted.
   */
  async reorderTiers(orgId: string, tierIds: string[]) {
    await this.prisma.$transaction(
      tierIds.map((id, index) =>
        this.prisma.membershipTier.updateMany({
          where: { id, orgId },
          data: { sortOrder: index },
        }),
      ),
    );

    return this.listTiersForAdmin(orgId);
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
  /**
   * The service expectation, checked as a pair (SRV-01).
   *
   * Minutes with no period is a number over no stretch of time; a period with
   * no minutes is a stretch of time with nothing asked in it. Either alone
   * produces a tier that appears to ask something and reports nothing — and a
   * member being told they are short of an expectation nobody can state.
   *
   * `existing` is what the tier already holds, and it matters: without it, an
   * organiser changing only the period on a tier that already asks for four
   * hours would be refused for sending "half" an expectation, when in fact
   * they sent the half that changed.
   *
   * Nulling either half clears both, because no amount and no period are the
   * same answer — no expectation.
   */
  private serviceExpectation(
    dto: Partial<CreateTierDto>,
    existing?: { serviceMinutes: number | null; servicePeriod: string | null },
  ) {
    const touched = 'serviceMinutes' in dto || 'servicePeriod' in dto;
    if (!touched) return {};

    const minutes =
      'serviceMinutes' in dto ? (dto.serviceMinutes ?? null) : (existing?.serviceMinutes ?? null);
    const period =
      'servicePeriod' in dto ? (dto.servicePeriod ?? null) : (existing?.servicePeriod ?? null);

    if (minutes === null || period === null) {
      // One half missing, and the *other* half was asked for in this call.
      // That is a request for something the co-op cannot state — an amount
      // over no period, or a period with nothing asked in it — so it is
      // refused rather than quietly stored as nothing.
      const askedFor =
        (minutes !== null && 'serviceMinutes' in dto) ||
        (period !== null && 'servicePeriod' in dto);

      if (askedFor) {
        throw new BadRequestException(
          'A service expectation needs both an amount and a period — or neither, for no expectation.',
        );
      }

      // Nothing was asked for, so this is a clearing. Both go: no amount and
      // no period are the same answer, and a stray period left behind would
      // be a tier asking for a month of nothing.
      return { serviceMinutes: null, servicePeriod: null };
    }

    return { serviceMinutes: minutes, servicePeriod: period as never };
  }

  /**
   * Trim the badge to something renderable, in place (MEM-16).
   *
   * Returns the label when the write sets one, so the caller knows whether to
   * clear the other tiers. An omitted field means "leave it alone" and must
   * not be turned into an explicit null — the same distinction the service
   * expectation makes above.
   */
  private normalizeHighlight(fields: { highlightLabel?: string | null }): string | null {
    if (!('highlightLabel' in fields)) return null;
    const trimmed = typeof fields.highlightLabel === 'string' ? fields.highlightLabel.trim() : '';
    fields.highlightLabel = trimmed || null;
    return fields.highlightLabel;
  }

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

    // Pulled out of the spread rather than passed through it: `servicePeriod`
    // arrives as a string and Prisma wants the enum, and routing both through
    // the helper is what makes the pair check govern the write.
    const { serviceMinutes: _m, servicePeriod: _p, ...rest } = fields;
    const expectation = this.serviceExpectation(fields, tier);

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
      stripePriceIdMonthly = result.priceId ?? tier.stripePriceIdMonthly;
      migrated = result.migrated;

      // The org's Billing Portal configuration pins specific price ids, so it
      // now points at the Price we just archived — members would be offered a
      // tier they can no longer switch to. Clearing the cached id makes
      // ensurePortalConfiguration rebuild it on the next portal visit.
      await this.stripeService.forgetPortalConfigurations(orgId);
    }

    // The badge (MEM-16). Blank is not a badge: an admin who clears the text
    // means "stop showing it", and storing "" would render an empty pill.
    const highlight = this.normalizeHighlight(rest);

    const write = {
      where: { id: tierId },
      data: {
        ...rest,
        ...expectation,
        ...(priceChanged ? { stripePriceIdMonthly } : {}),
      },
    };

    // At most one highlighted tier per co-op. The card grows, gains a border
    // and carries a pill, which only reads as emphasis while one tier has it —
    // and an admin who highlights the Sustainer means *instead of*, not *as
    // well as*. Scoped to the org, like every write here (SEC-04).
    //
    // The transaction exists only for this pair: a set that lands without its
    // clear leaves two tiers badged, which is the state the rule prevents. An
    // ordinary edit is one write and takes the plain path.
    const updated = highlight
      ? (
          await this.prisma.$transaction([
            this.prisma.membershipTier.update(write),
            this.prisma.membershipTier.updateMany({
              where: { orgId, id: { not: tierId }, highlightLabel: { not: null } },
              data: { highlightLabel: null },
            }),
          ])
        )[0]
      : await this.prisma.membershipTier.update(write);

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

    // Said now, to the organiser, rather than later to the person invited.
    if (countsAsMember(role)) await assertMemberRoom(this.prisma, orgId, 1, 'organiser');

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
        expiresAt: new Date(Date.now() + org.inviteExpiryDays * 24 * 60 * 60 * 1000),
      },
    });

    const inviteUrl = `${this.webUrl()}/invite?token=${invitation.token}`;

    const { subject, html } = await this.renderForOrg(orgId, 'INVITE', {
      community_name: org.name,
      inviter_name: inviter?.name || 'An organiser',
      invite_url: inviteUrl,
      expiry_days: String(org.inviteExpiryDays),
    });

    await this.emailService.sendRaw(normalizedEmail, subject, html);

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

  /**
   * Accept an invitation, optionally with the tier the invitee chose (MEM-15).
   *
   * `chosenTierId` is only honoured when the invitation named no tier — an
   * admin who picked Sustainer picked Sustainer, and letting the invitee send
   * a different id would turn "assign a tier" into "suggest a tier". So the
   * admin's choice always wins, and the invitee only chooses when the admin
   * left it to them.
   */
  async acceptInvite(token: string, userId: string, chosenTierId?: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
    });

    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.acceptedAt) throw new BadRequestException('This invitation has already been accepted');
    if (invitation.expiresAt < new Date()) throw new BadRequestException('This invitation has expired');

    // Resolved before anything is written, so an invitee who sends a tier id
    // from another co-op is refused rather than quietly joined tier-less.
    let tierId = invitation.tierId;
    if (!tierId && chosenTierId) {
      if (invitation.role !== 'MEMBER') {
        throw new BadRequestException('Only member invitations carry dues');
      }
      const tier = await this.prisma.membershipTier.findFirst({
        where: { id: chosenTierId, orgId: invitation.orgId, isActive: true },
        select: { id: true },
      });
      if (!tier) throw new NotFoundException('That membership tier is not available');
      tierId = tier.id;
    }

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

    if (countsAsMember(invitation.role)) {
      await assertMemberRoom(this.prisma, invitation.orgId, 1, 'joiner');
    }

    await this.prisma.$transaction([
      this.prisma.userOrg.create({
        data: {
          userId,
          orgId: invitation.orgId,
          role: invitation.role,
          // The tier the invitation named, or the one the invitee chose when
          // the admin left it to them (MEM-04, MEM-15). Without this an
          // invited member joined with no tier and no dues, while somebody
          // arriving through the public page paid — one co-op, two prices,
          // decided by which door you came through.
          tierId,
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
    if (membership) {
      this.startBuddySearch(invitation.orgId, membership.id);
      this.sendWelcome(invitation.orgId, userId);
      // Events and rooms they ran before, waiting under their address
      // (CAL-03). Not awaited: `claimPastHosting` swallows its own failures,
      // and nothing about accepting an invitation should wait on it.
      void this.prisma.user
        .findUnique({ where: { id: userId }, select: { email: true } })
        .then((user) => user?.email && this.claimPastHosting(invitation.orgId, userId, user.email));
    }

    // The tier travels back so the web app knows whether to hand off to
    // checkout. Returning only the org is what made the invitation path stop
    // short of payment.
    return {
      status: 'accepted',
      orgId: invitation.orgId,
      tierId,
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
  /**
   * Welcome somebody who has just become a member (MEM-17).
   *
   * **Deliberately not awaited, and deliberately not on the bulk importer or
   * the Stripe adoption** — the same two rules as the buddy search above, for
   * the same reason. An import is a co-op moving house, not 364 arrivals, and
   * welcoming a roster to a place they have belonged to for three years is
   * the most embarrassing possible first email. Adoption is the same event
   * seen from the money's side.
   *
   * Off until a co-op turns it on. MaybeItsFate had a Zapier automation
   * sending this from Stripe, and it welcomed Charley to the old system in
   * the middle of testing the new one; two welcomes is worse than none, so
   * this waits for the other one to be switched off.
   *
   * A member who arrives through an invitation gets this *as well as* the
   * invitation — the invitation asked them to come, and this one is the first
   * thing that treats them as having arrived.
   */
  /**
   * The co-op's own words for one of its emails, or MaybeOS's where it has
   * written none (MEM-17, MEM-18).
   *
   * Absence means "use the default" rather than a stored copy of it, so a
   * co-op that never opens the editor keeps getting improvements to the
   * wording instead of a snapshot of the day they joined.
   */
  private async renderForOrg(
    orgId: string,
    kind: BelongingEmailKindName,
    values: Record<string, string>,
  ) {
    const custom = await this.prisma.belongingEmailTemplate.findUnique({
      where: { orgId_kind: { orgId, kind } },
    });

    return renderTemplate(custom ?? DEFAULT_TEMPLATES[kind], values);
  }

  /** `WEB_URL`, which is what every member-facing link in this service uses. */
  private webUrl(): string {
    return this.configService.get<string>('WEB_URL') ?? 'https://maybeos.org';
  }

  private sendWelcome(orgId: string, userId: string): void {
    void (async () => {
      const [org, user, membership] = await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, slug: true, welcomeEmailEnabled: true },
        }),
        this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
        this.prisma.userOrg.findFirst({
          where: { orgId, userId },
          select: { altEmail: true },
        }),
      ]);

      if (!org?.welcomeEmailEnabled || !user?.email) return;

      // The co-op's own words where it has written them, MaybeOS's where it
      // has not — the same store and the same renderer the Belonging emails
      // use. Absence means "use the default" rather than a stored copy of it,
      // so a co-op that never opens the editor keeps getting improvements to
      // the wording instead of a snapshot of whatever shipped the day they
      // joined.
      const { subject, html } = await this.renderForOrg(orgId, 'WELCOME', {
        member_name: user.name ?? 'there',
        community_name: org.name,
        member_url: `${this.webUrl()}/member/${org.slug}`,
      });

      await this.emailService.sendRaw(
        { primary: user.email, also: membership?.altEmail },
        subject,
        html,
      );
    })().catch((err) => {
      this.logger.error(`Could not welcome ${userId} to ${orgId}: ${(err as Error).message}`);
    });
  }

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
      data: { expiresAt: new Date(Date.now() + org.inviteExpiryDays * 24 * 60 * 60 * 1000) },
    });

    const inviteUrl = `${this.webUrl()}/invite?token=${updated.token}`;

    const { subject, html } = await this.renderForOrg(orgId, 'INVITE', {
      community_name: org.name,
      inviter_name: resender?.name || 'An organiser',
      invite_url: inviteUrl,
      expiry_days: String(org.inviteExpiryDays),
    });

    await this.emailService.sendRaw(invitation.email, subject, html);

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
/** The most one call will ever take on. The deadline below usually stops it first. */
  private static readonly SIGN_IN_BATCH = 100;

  /**
   * How long one call may spend sending, in milliseconds (MEM-23).
   *
   * Netlify kills a synchronous function at ten seconds. Each member here
   * costs two database writes, a template render and a call to Postmark —
   * somewhere between a third and two-thirds of a second — so a batch of a
   * hundred is thirty to sixty seconds and never finishes.
   *
   * This is the third time that limit has bitten (CAL-05, CAL-06, EVT-38),
   * and it is the worst place for it: the mark goes in before the email goes
   * out, so a member killed mid-flight is recorded as sent, never emailed,
   * and skipped by every retry. One person silently never gets their way in,
   * out of four hundred, with nothing to say which one.
   *
   * So the loop stops on the clock, between members, and says how many are
   * left. `signInSentAt` is already the cursor — pressing again continues.
   */
  private static readonly SIGN_IN_DEADLINE_MS = 7_000;

  /**
   * How many members are handled at once (MEM-23).
   *
   * Modest on purpose. Postmark would take far more, but the database sits
   * behind a connection pooler, and a burst big enough to exhaust it turns a
   * slow send into a failing one — which on this particular job means a
   * member marked as written to who never hears from us.
   */
  private static readonly SIGN_IN_CONCURRENCY = 8;

  /**
   * Tell members who are already here how to get in (MEM-18).
   *
   * **The email a co-op moving in sends its whole roster**, and it exists
   * because the invitation path cannot do this job: `inviteMember` refuses
   * anybody who already has a membership, and after an import all of them
   * do. An imported member has an account with no password and has belonged
   * to the co-op for years. Inviting them to join something they are already
   * part of is the wrong sentence; this one says nothing has changed and
   * here is the way in.
   *
   * **Who gets it:** members who have never set a password and have never
   * been sent one of these. That is the honest reading of "has no way in
   * yet" — somebody who has signed in, by password or by asking for a link,
   * does not need telling.
   *
   * **Marked before sending**, like door codes and the Radar digest, because
   * `EmailService` swallows failures: the only thing a marker can honestly
   * mean is that we tried. A member missed once is better than a roster
   * emailed twice.
   *
   * The link is a magic link with the co-op's own expiry rather than the
   * fifteen minutes a self-service one gets — an email read the next morning
   * has to still work. It signs them straight in; there is no password to
   * invent.
   */
  async sendSignInLinks(
    orgId: string,
    options: { limit?: number; dryRun?: boolean } = {},
  ): Promise<{ sent: number; remaining: number; recipients: string[]; dryRun: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, inviteExpiryDays: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const where: Prisma.UserOrgWhereInput = {
      orgId,
      role: { in: ['ADMIN', 'STAFF', 'MEMBER'] },
      signInSentAt: null,
      // Never set a password, so they have no way in yet. Somebody who has
      // signed in — by password or by asking for a link — does not need
      // telling how.
      user: { passwordHash: null },
    };

    const limit = Math.min(options.limit ?? MemberService.SIGN_IN_BATCH, MemberService.SIGN_IN_BATCH);

    const waiting = await this.prisma.userOrg.findMany({
      where,
      select: {
        id: true,
        userId: true,
        altEmail: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: { memberSince: 'asc' },
      take: limit,
    });

    const total = await this.prisma.userOrg.count({ where });

    if (options.dryRun) {
      return {
        sent: 0,
        remaining: total,
        recipients: waiting.map((m) => m.user.email),
        dryRun: true,
      };
    }

    const expiry = new Date(Date.now() + org.inviteExpiryDays * 24 * 60 * 60 * 1000);
    const stopBy = Date.now() + MemberService.SIGN_IN_DEADLINE_MS;

    /*
      The co-op's own wording, read once (MEM-23).

      This was a database lookup per member — four hundred and thirty-five
      identical reads of one row. With a transaction and a call to Postmark
      either side of it, a member cost three sequential round trips and about
      a quarter of a second, so the first real batch got through twenty-six
      people in seven seconds and Charley was facing sixteen more presses.
    */
    const custom = await this.prisma.belongingEmailTemplate.findUnique({
      where: { orgId_kind: { orgId, kind: 'SIGN_IN' } },
    });
    const template = custom ?? DEFAULT_TEMPLATES.SIGN_IN;
    const webUrl = this.webUrl();

    let sent = 0;

    /*
      In small groups rather than one at a time.

      Each member is two round trips that have nothing to do with each
      other's, so waiting for one before starting the next spends the whole
      budget on latency. Eight at a time is deliberately modest: Postmark is
      happy with far more, but the database sits behind a connection pooler
      and a burst large enough to exhaust it would turn a slow send into a
      failing one.

      The deadline is checked between groups, never inside one — a group that
      has started always finishes, so nobody is left marked-but-unsent.
    */
    for (let i = 0; i < waiting.length; i += MemberService.SIGN_IN_CONCURRENCY) {
      if (Date.now() > stopBy) break;

      const group = waiting.slice(i, i + MemberService.SIGN_IN_CONCURRENCY);

      const results = await Promise.all(
        group.map(async (member) => {
          if (!member.user?.email) return false;

          const token = randomUUID();

          await this.prisma.$transaction([
            this.prisma.user.update({
              where: { id: member.userId },
              data: { magicLinkToken: token, magicLinkExpiry: expiry },
            }),
            this.prisma.userOrg.update({
              where: { id: member.id },
              data: { signInSentAt: new Date() },
            }),
          ]);

          const { subject, html } = renderTemplate(template, {
            member_name: member.user.name ?? 'there',
            community_name: org.name,
            sign_in_url: `${webUrl}/magic-link?token=${token}`,
            expiry_days: String(org.inviteExpiryDays),
          });

          // Both addresses (MEM-19). This is the send where choosing wrong is
          // worst: the link arrives somewhere they never look, and the member
          // concludes MaybeOS does not work.
          await this.emailService.sendRaw(
            { primary: member.user.email, also: member.altEmail },
            subject,
            html,
          );
          return true;
        }),
      );

      sent += results.filter(Boolean).length;
    }

    return { sent, remaining: Math.max(0, total - sent), recipients: [], dryRun: false };
  }

  /** Visible to the tests that prove the deadline exists (MEM-23). */
  static get signInDeadlineMs(): number {
    return MemberService.SIGN_IN_DEADLINE_MS;
  }

  async importMembers(orgId: string, rows: ImportMemberRowDto[]) {
    const results = {
      created: 0,
      /** Already a member here, and already had everything this row offered. */
      alreadyMembers: 0,
      /** Already a member, and this row filled in something that was blank. */
      enriched: 0,
      /** Had a MaybeOS account already; joined to this co-op. */
      linkedExistingUsers: 0,
      /** Imported with an avatar still to copy across. */
      avatarsPending: 0,
      errors: [] as Array<{ email: string; reason: string }>,
    };

    // The co-op's own tiers, read once: a roster names them, and a per-row
    // lookup would be 426 queries to answer the same question (MEM-21).
    const tiers = await this.prisma.membershipTier.findMany({
      where: { orgId },
      select: { id: true, name: true },
    });

    // The Free plan's limit (PAY-09). Rows past it are reported, not imported,
    // so the organiser sees exactly who did not come across and why.
    let room = await memberRoom(this.prisma, orgId);
    const FULL =
      `Not imported: the Free plan allows up to ${FREE_PLAN_MEMBER_LIMIT} members. Upgrade in Settings to add more.`;

    for (const row of rows) {
      const email = row.email.toLowerCase().trim();

      try {
        // Before any write: an unknown tier name should stop this row, not
        // leave an account behind with no membership.
        const tierId = tierIdFor(row.tier, tiers);

        let user = await this.prisma.user.findUnique({
          where: { email },
          select: { id: true, avatarUrl: true },
        });

        // Nobody new is made for a place that is not there.
        if (!user && room !== null && room <= 0) {
          results.errors.push({ email, reason: FULL });
          continue;
        }

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
          select: {
            id: true,
            altEmail: true,
            tierId: true,
            bio: true,
            headline: true,
            location: true,
            tags: true,
            links: true,
            emailOptIn: true,
          },
        });

        if (existing) {
          // **Enrich, never overwrite.** This used to `continue`, which was
          // right when a .csv was the only way in and a second run meant
          // somebody importing the same file twice. It stopped being right
          // the moment memberships could arrive from Stripe: adoption creates
          // a membership holding an email and nothing else, and a roster
          // imported afterwards would silently decline to fill in a single
          // name, bio or join date — the money without the people.
          //
          // Only empty fields are filled, so a member who has since written
          // their own bio keeps it, and running the import twice is still a
          // no-op the second time.
          const filled = enrichment(existing, { ...row, tierId });

          if (Object.keys(filled).length > 0) {
            await this.prisma.userOrg.update({ where: { id: existing.id }, data: filled });
            results.enriched++;
          } else {
            results.alreadyMembers++;
          }
          continue;
        }

        if (room !== null && room <= 0) {
          results.errors.push({ email, reason: FULL });
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
            // A second address the same person reads (MEM-19), lowercased
            // the way every other address here is.
            altEmail: row.altEmail?.trim().toLowerCase() || null,
            // What they pay, where the roster said. Never a status: that is
            // Stripe's to tell, and this file cannot know it (MEM-21).
            ...(tierId && { tierId }),
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

        // Whatever they ran before they left (CAL-03). Awaited rather than
        // fired and forgotten: an import is already a batch, and a member who
        // sees their own events on their first visit is the point.
        await this.claimPastHosting(orgId, user.id, email);

        results.created++;
        if (room !== null) room--;
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

/**
 * What a .csv row can add to a membership that already exists.
 *
 * Only blanks are filled. A member who wrote their own headline keeps it, and
 * an import run twice changes nothing the second time — the property that
 * makes this safe to combine with Stripe adoption in either order.
 *
 * `memberSince` is deliberately absent: it always holds a value (the column
 * defaults to now, and adoption sets it from Stripe's own start date), so
 * there is no blank to fill and no way to tell a real join date from a
 * default. Overwriting it would let a .csv quietly move dates Stripe knows
 * better.
 */
export function enrichment(
  existing: {
    altEmail: string | null;
    tierId: string | null;
    bio: string | null;
    headline: string | null;
    location: string | null;
    tags: string[];
    links: string[];
    emailOptIn: boolean | null;
  },
  row: {
    altEmail?: string;
    tierId?: string;
    bio?: string;
    headline?: string;
    location?: string;
    tags?: string[];
    links?: string[];
    emailOptIn?: boolean;
  },
): Record<string, unknown> {
  const filled: Record<string, unknown> = {};

  const text = (current: string | null, incoming?: string) =>
    !current && incoming?.trim() ? incoming.trim() : undefined;

  // Never overwritten, like everything else here: a member who has given
  // their own second address outranks whatever a spreadsheet says.
  const altEmail = text(existing.altEmail, row.altEmail?.toLowerCase());
  if (altEmail !== undefined) filled.altEmail = altEmail;

  // A tier already on the membership outranks the file — it came from Stripe,
  // or from an organiser who set it on purpose, and both know better than a
  // spreadsheet exported from the system the co-op is leaving.
  if (!existing.tierId && row.tierId) filled.tierId = row.tierId;

  const bio = text(existing.bio, row.bio);
  if (bio !== undefined) filled.bio = bio;

  const headline = text(existing.headline, row.headline);
  if (headline !== undefined) filled.headline = headline;

  const location = text(existing.location, row.location);
  if (location !== undefined) filled.location = location;

  const tags = (row.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (existing.tags.length === 0 && tags.length > 0) filled.tags = tags;

  const links = safeLinks(row.links ?? []);
  if (existing.links.length === 0 && links.length > 0) filled.links = links;

  // Only when nobody has been asked. `false` is a refusal somebody made and
  // an import must not talk them out of it.
  if (existing.emailOptIn === null && row.emailOptIn !== undefined) {
    filled.emailOptIn = row.emailOptIn;
  }

  return filled;
}
