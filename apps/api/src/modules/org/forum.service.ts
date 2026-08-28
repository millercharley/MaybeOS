import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';

type PrismaTx = Prisma.TransactionClient;

/** What the forum is called and lives at, if it has to be created. */
export const FORUM_SLUG = 'community';
export const FORUM_NAME = 'The MaybeOS Community';

/**
 * MaybeOS's own forum (FRM-01).
 *
 * Every co-op's organisers land in one shared org so they can compare notes
 * with each other — which is the thing a co-op organiser has almost no way to
 * do, and the reason this is worth building rather than a mailing list.
 *
 * **A real organization, with a flag.** It inherits channels, posts,
 * proposals and moderation, and a second forum implementation would be a
 * second thing to secure and a second thing to forget about when the first
 * one changes. The flag exists only for the places the forum must *not*
 * behave like a co-op:
 *
 * - **Never billed.** `billingWaived` keeps the subscription machinery away
 *   from it. A per-member plan across every organiser on the platform would
 *   otherwise invoice MaybeOS to MaybeOS, monthly, at scale.
 * - **Never a customer.** The platform console lists co-ops paying for
 *   MaybeOS; the forum is MaybeOS, and counting it would make every figure on
 *   that screen one out.
 * - **Never auto-joins itself.** Creating the forum must not try to enrol its
 *   own creator in it.
 */
@Injectable()
export class ForumService {
  private readonly logger = new Logger(ForumService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The forum, or null if nobody has created it on this deployment. */
  async find() {
    return this.prisma.organization.findFirst({ where: { isPlatformForum: true } });
  }

  /**
   * Create the forum, once, and put every existing organiser in it.
   *
   * Idempotent: called twice it returns the forum it already made. The unique
   * index means a race cannot produce two, which matters because a second
   * forum would silently split the community in half and nothing else in the
   * system would notice.
   *
   * The backfill is the point of running it at all. A forum that only
   * contains co-ops founded after today is a forum with nobody in it on the
   * day it opens.
   */
  async ensure(createdByUserId: string) {
    const existing = await this.find();
    if (existing) return { forum: existing, created: false as const, backfilled: 0 };

    const forum = await this.prisma.organization.create({
      data: {
        name: FORUM_NAME,
        slug: FORUM_SLUG,
        isPlatformForum: true,
        mission:
          'Where the people running co-ops on MaybeOS compare notes with each other.',
        // Never billed. A per-member plan across every organiser on the
        // platform would invoice MaybeOS to MaybeOS, monthly, at scale.
        billingWaived: true,
        billingWaivedReason: 'MaybeOS’s own forum (FRM-01), not a customer.',
        allowPublicJoin: false,
        channels: {
          create: [
            {
              name: 'General',
              slug: 'general',
              description: 'Anything about running a co-op.',
              isDefault: true,
              isPublic: true,
            },
          ],
        },
        users: { create: { userId: createdByUserId, role: 'ADMIN', isPublic: false } },
      },
    });

    // Everybody already organising a co-op, so the room is not empty on day
    // one. Existing organisers who have opted out are skipped for the same
    // reason a second co-op does not drag somebody back.
    const organisers = await this.prisma.userOrg.findMany({
      where: {
        role: 'ADMIN',
        org: { isPlatformForum: false },
        user: { forumOptOutAt: null },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const backfill = organisers.filter((o) => o.userId !== createdByUserId);
    if (backfill.length > 0) {
      await this.prisma.userOrg.createMany({
        data: backfill.map((o) => ({
          userId: o.userId,
          orgId: forum.id,
          role: 'MEMBER' as const,
          isPublic: false,
        })),
        skipDuplicates: true,
      });
    }

    this.logger.log(`Forum created with ${backfill.length + 1} member(s)`);
    return { forum, created: true as const, backfilled: backfill.length };
  }

  /**
   * Put a co-op's founder into the forum.
   *
   * **Silent about every reason not to.** This runs inside org creation, and
   * the one thing it must never do is stop somebody founding a co-op. There
   * is no deployment where "the forum does not exist yet" should be an error
   * a new customer sees.
   *
   * Three reasons to decline, and all three are ordinary:
   * they left the forum before; they are already in it; or the org being
   * created *is* the forum.
   */
  async autoJoin(userId: string, createdOrgId: string, tx?: PrismaTx): Promise<'joined' | 'skipped'> {
    const db = tx ?? this.prisma;

    try {
      const forum = await db.organization.findFirst({
        where: { isPlatformForum: true },
        select: { id: true },
      });
      if (!forum || forum.id === createdOrgId) return 'skipped';

      const user = await db.user.findUnique({
        where: { id: userId },
        select: { forumOptOutAt: true },
      });
      // Somebody who has left is not asked again. Founding a second co-op is
      // not a change of mind.
      if (!user || user.forumOptOutAt) return 'skipped';

      const existing = await db.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId: forum.id } },
        select: { id: true },
      });
      if (existing) return 'skipped';

      await db.userOrg.create({
        data: {
          userId,
          orgId: forum.id,
          role: 'MEMBER',
          // **Not listed in the directory unless they choose to be.** They
          // did not ask to join this; being enrolled in a roster of every
          // MaybeOS customer without being asked is the kind of thing that is
          // fine until the day it is not. Posting works either way — it is
          // being *listed* that is opt-in.
          isPublic: false,
        },
      });

      return 'joined';
    } catch (err) {
      // Never fatal. Founding a co-op must not fail because a forum did not.
      this.logger.error(`Could not add ${userId} to the forum: ${(err as Error).message}`);
      return 'skipped';
    }
  }

  /**
   * Leave, and stay left.
   *
   * The opt-out is recorded on the user rather than inferred from the missing
   * membership, because a missing row is indistinguishable from never having
   * joined — and the difference decides what happens the next time they found
   * a co-op.
   */
  async leave(userId: string) {
    const forum = await this.find();
    if (!forum) throw new NotFoundException('There is no MaybeOS community on this deployment');

    await this.prisma.$transaction([
      this.prisma.userOrg.deleteMany({ where: { userId, orgId: forum.id } }),
      this.prisma.user.update({ where: { id: userId }, data: { forumOptOutAt: new Date() } }),
    ]);

    return { left: true };
  }

  /** Come back, for somebody who changed their mind. */
  async rejoin(userId: string) {
    const forum = await this.find();
    if (!forum) throw new NotFoundException('There is no MaybeOS community on this deployment');

    await this.prisma.user.update({ where: { id: userId }, data: { forumOptOutAt: null } });
    await this.prisma.userOrg.upsert({
      where: { userId_orgId: { userId, orgId: forum.id } },
      create: { userId, orgId: forum.id, role: 'MEMBER', isPublic: false },
      update: {},
    });

    return { joined: true };
  }

  /** Whether this member is in the forum, and whether they said no. */
  async statusFor(userId: string) {
    const forum = await this.find();
    if (!forum) return { available: false as const };

    const [membership, user] = await Promise.all([
      this.prisma.userOrg.findUnique({
        where: { userId_orgId: { userId, orgId: forum.id } },
        select: { id: true, isPublic: true },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { forumOptOutAt: true } }),
    ]);

    return {
      available: true as const,
      forum: { id: forum.id, name: forum.name, slug: forum.slug },
      member: membership !== null,
      listedInDirectory: membership?.isPublic ?? false,
      optedOut: user?.forumOptOutAt !== null && user?.forumOptOutAt !== undefined,
    };
  }
}
