import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { BuddyService } from '../../belonging/buddy.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Giving somebody back what they ran before (CAL-03).
 *
 * Charley, 2026-10-02: "If a member is missing because they left the co-op,
 * just note the name of this user in the past event. If the person re-joins
 * in the future, reconnect them to their past events."
 *
 * The co-op's calendar import keeps the Google organiser's address on
 * anything it could not match. This picks those up on the day somebody has a
 * membership again — without an organiser remembering to go looking, which is
 * the version that never happens.
 */

describe('claiming past hosting', () => {
  let service: MemberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn().mockResolvedValue([{ count: 3 }, { count: 2 }]),
      event: { updateMany: jest.fn() },
      booking: { updateMany: jest.fn() },
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

  it('reports what it reattached', async () => {
    const result = await service.claimPastHosting('org-1', 'u-sam', 'sam@example.com');

    expect(result).toEqual({ events: 3, bookings: 2 });
  });

  it('claims only events still waiting on that exact address', async () => {
    await service.claimPastHosting('org-1', 'u-sam', 'sam@example.com');

    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', hostId: null, hostEmail: 'sam@example.com' },
      data: { hostId: 'u-sam', hostEmail: null, hostName: null },
    });
  });

  it('never takes an event that already has a host', async () => {
    // An organiser may have assigned one by hand since the import. That is a
    // decision somebody made, and an address match does not outrank it.
    await service.claimPastHosting('org-1', 'u-sam', 'sam@example.com');

    expect(prisma.event.updateMany.mock.calls[0][0].where).toHaveProperty('hostId', null);
  });

  it('claims bookings only inside this co-op', async () => {
    // Addresses are global; memberships are not. A booking in another co-op
    // is none of this membership's business (D-020).
    await service.claimPastHosting('org-1', 'u-sam', 'sam@example.com');

    expect(prisma.booking.updateMany).toHaveBeenCalledWith({
      where: { bookedForEmail: 'sam@example.com', room: { orgId: 'org-1' } },
      data: { userId: 'u-sam', bookedForEmail: null, bookedForName: null },
    });
  });

  it('clears the address as it goes, so a second run finds nothing', async () => {
    await service.claimPastHosting('org-1', 'u-sam', 'sam@example.com');

    expect(prisma.event.updateMany.mock.calls[0][0].data.hostEmail).toBeNull();
    expect(prisma.booking.updateMany.mock.calls[0][0].data.bookedForEmail).toBeNull();
  });

  it('matches the address however it was typed', async () => {
    await service.claimPastHosting('org-1', 'u-sam', '  Sam@Example.com ');

    expect(prisma.event.updateMany.mock.calls[0][0].where.hostEmail).toBe('sam@example.com');
  });

  it('does nothing at all without an address', async () => {
    const result = await service.claimPastHosting('org-1', 'u-sam', '   ');

    expect(result).toEqual({ events: 0, bookings: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never stops somebody joining', async () => {
    // A three-year-old event that could not be relinked is a far better
    // outcome than a member who cannot get into their co-op.
    prisma.$transaction.mockRejectedValue(new Error('database went away'));

    await expect(service.claimPastHosting('org-1', 'u-sam', 'sam@example.com')).resolves.toEqual({
      events: 0,
      bookings: 0,
    });
  });
});
