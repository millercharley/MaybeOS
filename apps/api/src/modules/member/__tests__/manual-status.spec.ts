import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { MANUAL_STATUSES, isManualStatus, manualStatusRefusal } from '../manual-status';

/**
 * A status an organiser sets by hand (MEM-23).
 *
 * `subscriptionStatus` has only ever meant "what Stripe last said", which
 * stopped covering the membership once co-ops arrived with members who pay
 * nothing. MaybeItsFate has 110 people on a $0 tier who will never have a
 * Stripe subscription; every one showed as NONE in the roster and read "Not
 * set up" on their own billing page — Stripe being asked to answer a question
 * about whether somebody is a member.
 */

describe('which statuses an organiser may choose', () => {
  it('offers the four that describe a membership', () => {
    expect(MANUAL_STATUSES).toEqual(['ACTIVE', 'PAST_DUE', 'CANCELED', 'NONE']);
  });

  it('refuses anything else', () => {
    // INCOMPLETE and TRIALING are states Stripe puts a subscription in. A
    // membership nobody is billing cannot be in them.
    expect(isManualStatus('ACTIVE')).toBe(true);
    expect(isManualStatus('TRIALING')).toBe(false);
    expect(isManualStatus('active')).toBe(false);
    expect(isManualStatus('')).toBe(false);
  });
});

describe('whether a status may be set by hand at all', () => {
  it('allows it where nothing is billing them', () => {
    expect(manualStatusRefusal({ stripeSubscriptionId: null })).toBeNull();
  });

  it('refuses where Stripe is', () => {
    // The dangerous case. A manual status here is overwritten by the next
    // webhook, so it is right until it silently is not — and in between it
    // is the screen an organiser trusts.
    expect(manualStatusRefusal({ stripeSubscriptionId: 'sub_123' })).toMatch(/Stripe is billing/);
  });

  it('says who is deciding instead, rather than just saying no', () => {
    expect(manualStatusRefusal({ stripeSubscriptionId: 'sub_123' })).toMatch(/Change it in Stripe/);
  });
});

describe('setting it', () => {
  let service: MemberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue({ stripeSubscriptionId: null }),
        update: jest.fn().mockResolvedValue({ userId: 'user-1', subscriptionStatus: 'ACTIVE' }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: BuddyService, useValue: {} },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('writes the status an organiser chose', async () => {
    const result = await service.setMemberStatus('org-1', 'user-1', 'ACTIVE');

    expect(prisma.userOrg.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subscriptionStatus: 'ACTIVE' }) }),
    );
    expect(result).toEqual({ updated: true, subscriptionStatus: 'ACTIVE' });
  });

  it('clears any period left over from a subscription', async () => {
    // Otherwise a $0 member's own page announces a renewal that is not going
    // to happen, on a date nothing will ever reach.
    await service.setMemberStatus('org-1', 'user-1', 'ACTIVE');

    expect(prisma.userOrg.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cancelAtPeriodEnd: false, currentPeriodEnd: null }),
      }),
    );
  });

  it('changes nothing for a member Stripe is billing', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({ stripeSubscriptionId: 'sub_123' });

    await expect(service.setMemberStatus('org-1', 'user-1', 'CANCELED')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.userOrg.update).not.toHaveBeenCalled();
  });

  it('refuses somebody who is not in this co-op', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(null);

    await expect(service.setMemberStatus('org-1', 'nobody', 'ACTIVE')).rejects.toThrow(
      NotFoundException,
    );
  });
});
