import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { OnboardingStepKind } from '@prisma/client';
import { PrismaService } from '../../config/prisma.service';
import { DEFAULT_STEPS, defaultHref } from './defaults';

/** What a member's checklist looks like once completion has been worked out. */
export interface MemberStep {
  id: string;
  kind: OnboardingStepKind;
  title: string;
  description: string | null;
  ctaLabel: string;
  href: string | null;
  done: boolean;
  /** Whether the member ticks this themselves, or MaybeOS works it out. */
  selfMarked: boolean;
}

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Org scoping (SEC-04) ───────────────────────────────────

  private async findStepInOrg(orgId: string, stepId: string) {
    const step = await this.prisma.onboardingStep.findFirst({
      where: { id: stepId, orgId },
    });
    if (!step) throw new NotFoundException('Step not found');
    return step;
  }

  private async findOrg(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, onboardingEnabled: true },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  // ─── What the admin configures ──────────────────────────────

  async getConfig(orgId: string) {
    const org = await this.findOrg(orgId);
    const steps = await this.prisma.onboardingStep.findMany({
      where: { orgId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      enabled: org.onboardingEnabled,
      steps: steps.map((s) => ({
        ...s,
        // Shown in the admin so somebody editing a built-in step can see where
        // its button actually goes without having to guess.
        resolvedHref: s.href ?? defaultHref(s.kind, org.slug),
      })),
    };
  }

  /**
   * Turn the checklist on or off.
   *
   * Turning it on for the first time seeds the default steps. An admin who
   * flips the switch and is shown an empty list has been handed homework
   * rather than a feature — and the defaults are written to work unedited.
   *
   * Seeding happens only when there are no steps at all, so a co-op that
   * turned it off, deleted everything and turned it back on gets the defaults
   * again, while one that merely paused it keeps its own words.
   */
  async setEnabled(orgId: string, enabled: boolean) {
    await this.findOrg(orgId);

    if (enabled) {
      const existing = await this.prisma.onboardingStep.count({ where: { orgId } });
      if (existing === 0) {
        await this.prisma.onboardingStep.createMany({
          data: DEFAULT_STEPS.map((step, index) => ({ ...step, orgId, position: index })),
        });
      }
    }

    await this.prisma.organization.update({
      where: { id: orgId },
      data: { onboardingEnabled: enabled },
    });

    return this.getConfig(orgId);
  }

  async createStep(
    orgId: string,
    dto: {
      kind?: OnboardingStepKind;
      title: string;
      description?: string | null;
      ctaLabel?: string;
      href?: string | null;
    },
  ) {
    await this.findOrg(orgId);

    const title = dto.title.trim();
    if (!title) throw new BadRequestException('A step needs a title.');

    const last = await this.prisma.onboardingStep.findFirst({
      where: { orgId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.onboardingStep.create({
      data: {
        orgId,
        kind: dto.kind ?? 'CUSTOM',
        title,
        description: dto.description ?? null,
        ...(dto.ctaLabel?.trim() ? { ctaLabel: dto.ctaLabel.trim() } : {}),
        href: dto.href ?? null,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async updateStep(
    orgId: string,
    stepId: string,
    dto: {
      kind?: OnboardingStepKind;
      title?: string;
      description?: string | null;
      ctaLabel?: string;
      href?: string | null;
      isActive?: boolean;
    },
  ) {
    await this.findStepInOrg(orgId, stepId);

    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) {
      throw new BadRequestException('A step needs a title.');
    }
    const ctaLabel = dto.ctaLabel?.trim();
    if (dto.ctaLabel !== undefined && !ctaLabel) {
      throw new BadRequestException('A step needs a button label.');
    }

    return this.prisma.onboardingStep.update({
      where: { id: stepId },
      data: {
        ...(dto.kind !== undefined && { kind: dto.kind }),
        ...(title && { title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(ctaLabel && { ctaLabel }),
        ...(dto.href !== undefined && { href: dto.href }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteStep(orgId: string, stepId: string) {
    await this.findStepInOrg(orgId, stepId);
    await this.prisma.onboardingStep.delete({ where: { id: stepId } });
    return { deleted: stepId };
  }

  /**
   * The whole order in one write, scoped per row.
   *
   * Same reasoning as the Commons channels (CMN-10): a move-this-one endpoint
   * renumbers its neighbours anyway, and two admins doing that at once leaves
   * two steps claiming one position. Ids from another co-op are filtered out
   * by the scoped `updateMany` rather than trusted.
   */
  async reorderSteps(orgId: string, stepIds: string[]) {
    await this.prisma.$transaction(
      stepIds.map((id, index) =>
        this.prisma.onboardingStep.updateMany({
          where: { id, orgId },
          data: { position: index },
        }),
      ),
    );
    return this.getConfig(orgId);
  }

  // ─── What a member sees ─────────────────────────────────────

  /**
   * One member's checklist, with every step's completion worked out.
   *
   * Returns `null` when there is nothing to show — the co-op has it switched
   * off, has no active steps, or this member has already put it away. The
   * sidebar renders nothing at all in that case rather than an empty card.
   */
  async forMember(orgId: string, userId: string) {
    const org = await this.findOrg(orgId);
    if (!org.onboardingEnabled) return null;

    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { id: true, bio: true, headline: true, onboardingDismissedAt: true },
    });
    if (!membership) return null;
    if (membership.onboardingDismissedAt) return null;

    const steps = await this.prisma.onboardingStep.findMany({
      where: { orgId, isActive: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    if (steps.length === 0) return null;

    const done = await this.completedKinds(orgId, userId, membership, steps);

    const resolved: MemberStep[] = steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      title: step.title,
      description: step.description,
      ctaLabel: step.ctaLabel,
      href: step.href ?? defaultHref(step.kind, org.slug),
      done: done.has(step.id),
      selfMarked: step.kind === 'CUSTOM',
    }));

    const completed = resolved.filter((s) => s.done).length;

    return {
      slug: org.slug,
      steps: resolved,
      completed,
      total: resolved.length,
      /** The first thing not done — the one the accordion opens. */
      activeStepId: resolved.find((s) => !s.done)?.id ?? null,
      allDone: completed === resolved.length,
    };
  }

  /**
   * Which of these steps this member has finished.
   *
   * **Derived, not stored** — except for CUSTOM, which nothing can verify.
   * A co-op asking somebody to fill in their profile wants the profile filled
   * in, not a claim that it was; and a member who did the thing before the
   * checklist existed should arrive with it already ticked, which only a
   * derived answer gives them.
   *
   * One query per kind that is actually on the list, and none for a kind the
   * co-op did not ask for. `exists`-shaped: every one of these is "has this
   * member ever done it", so a `findFirst` selecting one id beats a count.
   */
  private async completedKinds(
    orgId: string,
    userId: string,
    membership: { id: string; bio: string | null; headline: string | null },
    steps: Array<{ id: string; kind: OnboardingStepKind }>,
  ): Promise<Set<string>> {
    const kinds = new Set(steps.map((s) => s.kind));
    const has = async (
      kind: OnboardingStepKind,
      check: () => Promise<boolean>,
    ): Promise<[OnboardingStepKind, boolean]> =>
      kinds.has(kind) ? [kind, await check()] : [kind, false];

    const [profile, handbook, post, rsvp, booking, service, custom] = await Promise.all([
      has('PROFILE', async () => {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        // A name and something about themselves. Either the headline or the
        // bio counts: the ask is "so people know who you are", and one good
        // line does that as well as a paragraph.
        return Boolean(user?.name?.trim() && (membership.headline?.trim() || membership.bio?.trim()));
      }),
      has('HANDBOOK', async () => {
        const ack = await this.prisma.articleAcknowledgment.findFirst({
          where: { memberId: membership.id },
          select: { id: true },
        });
        return Boolean(ack);
      }),
      has('COMMONS_POST', async () => {
        // A post or a comment. Somebody who answered a thread has said hello
        // as surely as somebody who started one.
        const [written, replied] = await Promise.all([
          this.prisma.post.findFirst({
            where: { authorId: userId, channel: { orgId } },
            select: { id: true },
          }),
          this.prisma.comment.findFirst({
            where: { authorId: userId, post: { channel: { orgId } } },
            select: { id: true },
          }),
        ]);
        return Boolean(written || replied);
      }),
      has('EVENT_RSVP', async () => {
        const going = await this.prisma.rsvp.findFirst({
          where: { userId, event: { orgId }, status: { not: 'CANCELED' } },
          select: { id: true },
        });
        return Boolean(going);
      }),
      has('ROOM_BOOKING', async () => {
        const booked = await this.prisma.booking.findFirst({
          where: { userId, room: { orgId } },
          select: { id: true },
        });
        return Boolean(booked);
      }),
      has('SERVICE_CLAIM', async () => {
        const claim = await this.prisma.dutyClaim.findFirst({
          where: { userId: membership.id, duty: { orgId }, status: { not: 'RELEASED' } },
          select: { id: true },
        });
        return Boolean(claim);
      }),
      has('CUSTOM', async () => true),
    ]);

    const byKind = new Map<OnboardingStepKind, boolean>(
      [profile, handbook, post, rsvp, booking, service].map(([k, v]) => [k, v]),
    );

    // CUSTOM is per step, not per kind — two custom steps are two different
    // things and are ticked separately.
    const ticked = custom[1]
      ? new Set(
          (
            await this.prisma.onboardingCompletion.findMany({
              where: { memberId: membership.id, step: { orgId } },
              select: { stepId: true },
            })
          ).map((c) => c.stepId),
        )
      : new Set<string>();

    const complete = new Set<string>();
    for (const step of steps) {
      if (step.kind === 'CUSTOM' ? ticked.has(step.id) : byKind.get(step.kind)) {
        complete.add(step.id);
      }
    }
    return complete;
  }

  /**
   * A member ticking off a custom step.
   *
   * Refuses anything else, and says why. A built-in step is derived from what
   * the member has done, so accepting a tick for one would let somebody mark
   * "complete your profile" done with an empty profile — and the next read,
   * which recomputes, would quietly un-tick it. A rule the product enforces
   * inconsistently is worse than one it refuses cleanly.
   */
  async completeStep(orgId: string, userId: string, stepId: string) {
    const step = await this.findStepInOrg(orgId, stepId);
    if (step.kind !== 'CUSTOM') {
      throw new BadRequestException(
        'This step completes itself once you have done the thing it asks for.',
      );
    }

    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Not a member of this organization');

    await this.prisma.onboardingCompletion.upsert({
      where: { stepId_memberId: { stepId, memberId: membership.id } },
      // Ticking twice is the same fact, not two — and a double click on a
      // phone must not be a unique-constraint error in somebody's face.
      update: {},
      create: { stepId, memberId: membership.id },
    });

    return this.forMember(orgId, userId);
  }

  /** Undo a tick, for a custom step ticked by mistake. */
  async uncompleteStep(orgId: string, userId: string, stepId: string) {
    await this.findStepInOrg(orgId, stepId);
    const membership = await this.prisma.userOrg.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Not a member of this organization');

    await this.prisma.onboardingCompletion.deleteMany({
      where: { stepId, memberId: membership.id },
    });

    return this.forMember(orgId, userId);
  }

  /**
   * Put the checklist away for good.
   *
   * Only once everything is done. The pattern's whole point is that this is a
   * permanent fixture rather than a dismissible overlay, and a checklist you
   * can close on day one is a checklist nobody finishes — but one that stays
   * after the last tick is a product that will not let you leave.
   */
  async dismiss(orgId: string, userId: string) {
    const state = await this.forMember(orgId, userId);
    if (!state) return null;
    if (!state.allDone) {
      throw new BadRequestException('There are still steps left.');
    }

    await this.prisma.userOrg.update({
      where: { userId_orgId: { userId, orgId } },
      data: { onboardingDismissedAt: new Date() },
    });

    return null;
  }
}
