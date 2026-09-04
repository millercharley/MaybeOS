import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OnboardingService } from '../onboarding.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * The getting-started checklist (ONB-01).
 *
 * The load-bearing decision is that completion is **derived** for every kind
 * but CUSTOM. A stored tick would let "complete your profile" read as done
 * against an empty profile, and would hide the fact that somebody who did the
 * thing last month already qualifies. These tests are the cases where a
 * stored-tick implementation would have said something untrue.
 */
describe('OnboardingService', () => {
  let service: OnboardingService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const USER = 'user-1';
  const MEMBER = 'membership-1';

  const membership = (over: Record<string, unknown> = {}) => ({
    id: MEMBER,
    bio: null,
    headline: null,
    onboardingDismissedAt: null,
    ...over,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        {
          provide: PrismaService,
          useValue: {
            organization: {
              findUnique: jest.fn().mockResolvedValue({
                id: ORG, slug: 'sunrise', onboardingEnabled: true,
              }),
              update: jest.fn(),
            },
            userOrg: { findUnique: jest.fn(), update: jest.fn() },
            onboardingStep: {
              findMany: jest.fn().mockResolvedValue([]),
              findFirst: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn(),
              createMany: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
            },
            onboardingCompletion: {
              findMany: jest.fn().mockResolvedValue([]),
              upsert: jest.fn(),
              deleteMany: jest.fn(),
            },
            user: { findUnique: jest.fn().mockResolvedValue({ name: null }) },
            articleAcknowledgment: { findFirst: jest.fn().mockResolvedValue(null) },
            post: { findFirst: jest.fn().mockResolvedValue(null) },
            comment: { findFirst: jest.fn().mockResolvedValue(null) },
            rsvp: { findFirst: jest.fn().mockResolvedValue(null) },
            booking: { findFirst: jest.fn().mockResolvedValue(null) },
            dutyClaim: { findFirst: jest.fn().mockResolvedValue(null) },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
    prisma = module.get(PrismaService);
  });

  describe('what a member sees', () => {
    beforeEach(() => {
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);
    });

    it('shows nothing when the co-op has it switched off', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        id: ORG, slug: 'sunrise', onboardingEnabled: false,
      } as never);

      await expect(service.forMember(ORG, USER)).resolves.toBeNull();
    });

    it('shows nothing when the co-op has written no steps', async () => {
      // An empty card in the sidebar is worse than no card.
      prisma.onboardingStep.findMany.mockResolvedValue([] as never);

      await expect(service.forMember(ORG, USER)).resolves.toBeNull();
    });

    it('shows nothing to a member who has already put it away', async () => {
      prisma.userOrg.findUnique.mockResolvedValue(
        membership({ onboardingDismissedAt: new Date() }) as never,
      );
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'PROFILE', title: 'Profile', description: null, ctaLabel: 'Go', href: null },
      ] as never);

      await expect(service.forMember(ORG, USER)).resolves.toBeNull();
    });

    it('opens the accordion on the first thing not done', async () => {
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'PROFILE', title: 'Profile', description: null, ctaLabel: 'Go', href: null },
        { id: 's2', kind: 'EVENT_RSVP', title: 'Come to something', description: null, ctaLabel: 'Go', href: null },
        { id: 's3', kind: 'HANDBOOK', title: 'Read it', description: null, ctaLabel: 'Go', href: null },
      ] as never);
      // Profile is done; the RSVP is not.
      prisma.user.findUnique.mockResolvedValue({ name: 'Alex' } as never);
      prisma.userOrg.findUnique.mockResolvedValue(membership({ headline: 'Baker' }) as never);

      const state = await service.forMember(ORG, USER);

      expect(state?.activeStepId).toBe('s2');
      expect(state?.completed).toBe(1);
      expect(state?.total).toBe(3);
      expect(state?.allDone).toBe(false);
    });

    it('resolves a built-in step’s destination from the co-op’s slug', async () => {
      // Stored hrefs would have gone stale the day /welcome became /handbook.
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'HANDBOOK', title: 'Read it', description: null, ctaLabel: 'Go', href: null },
      ] as never);

      const state = await service.forMember(ORG, USER);

      expect(state?.steps[0].href).toBe('/portal/sunrise/handbook');
    });

    it('lets a custom step point wherever the admin said', async () => {
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'CUSTOM', title: 'Sign the waiver', description: null, ctaLabel: 'Go', href: '/forms/waiver' },
      ] as never);

      const state = await service.forMember(ORG, USER);

      expect(state?.steps[0].href).toBe('/forms/waiver');
      expect(state?.steps[0].selfMarked).toBe(true);
    });
  });

  describe('deriving completion', () => {
    const withStep = (kind: string) => {
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind, title: 't', description: null, ctaLabel: 'Go', href: null },
      ] as never);
    };

    it('counts a profile only when there is a name AND a line about them', async () => {
      // A name alone is what registration already collected — treating that as
      // "profile complete" would tick the step for everybody on day one.
      withStep('PROFILE');
      prisma.user.findUnique.mockResolvedValue({ name: 'Alex' } as never);
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);

      expect((await service.forMember(ORG, USER))?.steps[0].done).toBe(false);

      prisma.userOrg.findUnique.mockResolvedValue(membership({ bio: 'I bake.' }) as never);
      expect((await service.forMember(ORG, USER))?.steps[0].done).toBe(true);
    });

    it('counts a comment as saying hello, not just a post', async () => {
      // Answering a thread is as much a first word as starting one.
      withStep('COMMONS_POST');
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);
      prisma.comment.findFirst.mockResolvedValue({ id: 'c1' } as never);

      expect((await service.forMember(ORG, USER))?.steps[0].done).toBe(true);
    });

    it('does not count a cancelled RSVP', async () => {
      withStep('EVENT_RSVP');
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);

      await service.forMember(ORG, USER);

      expect(prisma.rsvp.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'CANCELED' } }),
        }),
      );
    });

    it('does not count a duty that was handed back', async () => {
      withStep('SERVICE_CLAIM');
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);

      await service.forMember(ORG, USER);

      expect(prisma.dutyClaim.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: { not: 'RELEASED' } }),
        }),
      );
    });

    it('scopes every check to this co-op', async () => {
      // A member of two co-ops must not have one co-op's checklist ticked by
      // what they did in the other.
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'EVENT_RSVP', title: 't', description: null, ctaLabel: 'Go', href: null },
        { id: 's2', kind: 'ROOM_BOOKING', title: 't', description: null, ctaLabel: 'Go', href: null },
        { id: 's3', kind: 'COMMONS_POST', title: 't', description: null, ctaLabel: 'Go', href: null },
        { id: 's4', kind: 'SERVICE_CLAIM', title: 't', description: null, ctaLabel: 'Go', href: null },
      ] as never);
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);

      await service.forMember(ORG, USER);

      expect(prisma.rsvp.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ event: { orgId: ORG } }) }),
      );
      expect(prisma.booking.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ room: { orgId: ORG } }) }),
      );
      expect(prisma.post.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ channel: { orgId: ORG } }) }),
      );
      expect(prisma.dutyClaim.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ duty: { orgId: ORG } }) }),
      );
    });

    it('asks nothing about a kind the co-op did not put on the list', async () => {
      // One query per kind actually used, none for the rest.
      withStep('PROFILE');
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);

      await service.forMember(ORG, USER);

      expect(prisma.rsvp.findFirst).not.toHaveBeenCalled();
      expect(prisma.booking.findFirst).not.toHaveBeenCalled();
      expect(prisma.dutyClaim.findFirst).not.toHaveBeenCalled();
      expect(prisma.onboardingCompletion.findMany).not.toHaveBeenCalled();
    });

    it('ticks two custom steps separately', async () => {
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'CUSTOM', title: 'a', description: null, ctaLabel: 'Go', href: '/a' },
        { id: 's2', kind: 'CUSTOM', title: 'b', description: null, ctaLabel: 'Go', href: '/b' },
      ] as never);
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);
      prisma.onboardingCompletion.findMany.mockResolvedValue([{ stepId: 's1' }] as never);

      const state = await service.forMember(ORG, USER);

      expect(state?.steps.map((s) => s.done)).toEqual([true, false]);
    });
  });

  describe('ticking a step', () => {
    it('refuses a built-in step, and says why', async () => {
      // Accepting this would let somebody mark their profile complete with an
      // empty profile — and the next read, which recomputes, would un-tick it.
      prisma.onboardingStep.findFirst.mockResolvedValue({
        id: 's1', orgId: ORG, kind: 'PROFILE',
      } as never);

      await expect(service.completeStep(ORG, USER, 's1')).rejects.toThrow(BadRequestException);
      expect(prisma.onboardingCompletion.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent for a custom one', async () => {
      // A double tap on a phone must not be a unique-constraint error.
      prisma.onboardingStep.findFirst.mockResolvedValue({
        id: 's1', orgId: ORG, kind: 'CUSTOM',
      } as never);
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);
      prisma.onboardingStep.findMany.mockResolvedValue([] as never);

      await service.completeStep(ORG, USER, 's1');

      expect(prisma.onboardingCompletion.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: {} }),
      );
    });

    it('refuses a step id from another co-op', async () => {
      prisma.onboardingStep.findFirst.mockResolvedValue(null);

      await expect(service.completeStep(ORG, USER, 'elsewhere')).rejects.toThrow(NotFoundException);
    });
  });

  describe('putting it away', () => {
    beforeEach(() => {
      prisma.userOrg.findUnique.mockResolvedValue(membership() as never);
    });

    it('refuses while anything is still outstanding', async () => {
      // The pattern is a permanent fixture, not a dismissible overlay: a
      // checklist you can close on day one is one nobody finishes.
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'PROFILE', title: 't', description: null, ctaLabel: 'Go', href: null },
      ] as never);

      await expect(service.dismiss(ORG, USER)).rejects.toThrow(BadRequestException);
      expect(prisma.userOrg.update).not.toHaveBeenCalled();
    });

    it('lets it go once every step is done', async () => {
      // ...but one that stays after the last tick is a product that will not
      // let you leave.
      prisma.onboardingStep.findMany.mockResolvedValue([
        { id: 's1', kind: 'CUSTOM', title: 't', description: null, ctaLabel: 'Go', href: '/x' },
      ] as never);
      prisma.onboardingCompletion.findMany.mockResolvedValue([{ stepId: 's1' }] as never);

      await service.dismiss(ORG, USER);

      expect(prisma.userOrg.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { onboardingDismissedAt: expect.any(Date) } }),
      );
    });
  });

  describe('the admin’s side', () => {
    it('seeds usable defaults the first time it is switched on', async () => {
      // An admin who flips the switch and sees an empty list has been handed
      // homework, not a feature.
      await service.setEnabled(ORG, true);

      expect(prisma.onboardingStep.createMany).toHaveBeenCalled();
      const { data } = prisma.onboardingStep.createMany.mock.calls[0][0] as {
        data: Array<{ title: string; position: number }>;
      };
      expect(data.length).toBeGreaterThan(0);
      expect(data.map((d) => d.position)).toEqual(data.map((_, i) => i));
    });

    it('does not overwrite a co-op’s own words when switched back on', async () => {
      prisma.onboardingStep.count.mockResolvedValue(3 as never);

      await service.setEnabled(ORG, true);

      expect(prisma.onboardingStep.createMany).not.toHaveBeenCalled();
    });

    it('seeds nothing when it is switched off', async () => {
      await service.setEnabled(ORG, false);

      expect(prisma.onboardingStep.createMany).not.toHaveBeenCalled();
    });

    it('refuses a step with no title', async () => {
      await expect(service.createStep(ORG, { title: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('scopes every reorder write to this co-op', async () => {
      await service.reorderSteps(ORG, ['a', 'b']);

      expect(prisma.onboardingStep.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', orgId: ORG },
        data: { position: 0 },
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('refuses to edit or delete a step from another co-op', async () => {
      prisma.onboardingStep.findFirst.mockResolvedValue(null);

      await expect(service.updateStep(ORG, 'elsewhere', { title: 'x' })).rejects.toThrow(NotFoundException);
      await expect(service.deleteStep(ORG, 'elsewhere')).rejects.toThrow(NotFoundException);
      expect(prisma.onboardingStep.update).not.toHaveBeenCalled();
      expect(prisma.onboardingStep.delete).not.toHaveBeenCalled();
    });
  });
});
