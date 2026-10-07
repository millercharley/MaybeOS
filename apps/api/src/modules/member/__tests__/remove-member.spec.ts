import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { AuditService } from '../../platform/audit.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Removing somebody, and stopping their dues (MEM-20).
 *
 * Until this, removing a member deleted the membership and said nothing to
 * Stripe. Their subscription carried on billing them — on the co-op's own
 * account, for a co-op they had left — and the row holding the subscription
 * id was gone, so nothing in MaybeOS could find it again. Nobody would notice
 * until the member asked why they were still paying, and by then there would
 * be no record they had ever been a member.
 *
 * Found on 2026-10-02 when Charley asked what the Members page's kebab menu
 * did. It did nothing — the button had no handler — which is the only reason
 * the bug underneath it had never fired.
 */
describe('removing a member', () => {
  let service: MemberService;
  let prisma: any;
  let stripe: any;

  const paying = {
    userId: 'user-1',
    orgId: 'org-1',
    stripeSubscriptionId: 'sub_123',
    stripeDuesAccountId: 'acct_coop',
    subscriptionStatus: 'ACTIVE',
  };

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(paying),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    stripe = { cancelDuesNow: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: BuddyService, useValue: {} },
        { provide: AuditService, useValue: { record: jest.fn() } },
        { provide: StripeService, useValue: stripe },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
      ],
    }).compile();

    service = module.get(MemberService);
  });

  it('cancels their dues on the account the subscription lives on', async () => {
    await service.removeMember('org-1', 'user-1');

    expect(stripe.cancelDuesNow).toHaveBeenCalledWith('sub_123', 'acct_coop');
  });

  it('cancels before deleting, never after', async () => {
    const order: string[] = [];
    stripe.cancelDuesNow.mockImplementation(async () => {
      order.push('cancelled');
      return true;
    });
    prisma.userOrg.delete.mockImplementation(async () => {
      order.push('deleted');
      return {};
    });

    await service.removeMember('org-1', 'user-1');

    // A delete that succeeds after a failed cancel is the unrecoverable
    // version: the subscription id goes with the row.
    expect(order).toEqual(['cancelled', 'deleted']);
  });

  it('removes nobody when their dues cannot be stopped', async () => {
    stripe.cancelDuesNow.mockRejectedValue(new Error('Stripe is down'));

    await expect(service.removeMember('org-1', 'user-1')).rejects.toThrow(BadRequestException);
    expect(prisma.userOrg.delete).not.toHaveBeenCalled();
  });

  it('says plainly that nothing changed, rather than blaming the organiser', async () => {
    stripe.cancelDuesNow.mockRejectedValue(new Error('Stripe is down'));

    await expect(service.removeMember('org-1', 'user-1')).rejects.toThrow(
      /nothing was changed/i,
    );
  });

  it('does not call Stripe for somebody who never paid dues', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({
      ...paying,
      stripeSubscriptionId: null,
      subscriptionStatus: 'NONE',
    });

    const result = await service.removeMember('org-1', 'user-1');

    expect(stripe.cancelDuesNow).not.toHaveBeenCalled();
    expect(result).toEqual({ removed: true, duesCancelled: false });
    expect(prisma.userOrg.delete).toHaveBeenCalled();
  });

  it('does not call Stripe for a subscription that already ended', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({ ...paying, subscriptionStatus: 'CANCELED' });

    await service.removeMember('org-1', 'user-1');

    expect(stripe.cancelDuesNow).not.toHaveBeenCalled();
  });

  it('still removes them when Stripe says the subscription was already gone', async () => {
    // `cancelDuesNow` answers false for a subscription Stripe no longer has,
    // which is the outcome we wanted rather than a failure.
    stripe.cancelDuesNow.mockResolvedValue(false);

    const result = await service.removeMember('org-1', 'user-1');

    expect(result).toEqual({ removed: true, duesCancelled: false });
    expect(prisma.userOrg.delete).toHaveBeenCalled();
  });

  it('refuses a member who is not in this co-op', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(null);

    await expect(service.removeMember('org-1', 'nobody')).rejects.toThrow(NotFoundException);
    expect(stripe.cancelDuesNow).not.toHaveBeenCalled();
  });
});
