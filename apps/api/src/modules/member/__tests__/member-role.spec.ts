import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemberService } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';

/**
 * Changing what somebody may do in their co-op (ORG-02).
 *
 * The route has existed since the foundation with **nothing calling it**, so
 * the danger below was theoretical. Giving it a control in the members list
 * makes it reachable — and the first thing an admin could then do is demote
 * the last admin, locking their own co-op out of its settings, billing and
 * member list with no way back that does not involve database access.
 */
describe('MemberService — changing a role', () => {
  let service: MemberService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }),
        count: jest.fn().mockResolvedValue(2),
        update: jest.fn().mockImplementation(({ data }: any) => data),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => '' } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: {} },
        // Never reached here: the buddy search is fire-and-forget and off by default.
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  it('promotes a member', async () => {
    expect(await service.updateMemberRole('org-1', 'u1', 'ADMIN')).toEqual({ role: 'ADMIN' });
  });

  it('demotes an admin while another one exists', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.userOrg.count.mockResolvedValue(2);

    expect(await service.updateMemberRole('org-1', 'u1', 'MEMBER')).toEqual({ role: 'MEMBER' });
  });

  it('refuses to demote the last organiser', async () => {
    // A co-op with no organiser cannot reach its own settings, billing or
    // member list, and nothing in the product can undo it.
    prisma.userOrg.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.userOrg.count.mockResolvedValue(1);

    await expect(service.updateMemberRole('org-1', 'u1', 'MEMBER')).rejects.toThrow(BadRequestException);
    await expect(service.updateMemberRole('org-1', 'u1', 'MEMBER')).rejects.toThrow(/only organiser/i);
    expect(prisma.userOrg.update).not.toHaveBeenCalled();
  });

  it('counts admins rather than trusting the caller not to be the only one', async () => {
    prisma.userOrg.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.userOrg.count.mockResolvedValue(1);

    await service.updateMemberRole('org-1', 'u1', 'STAFF').catch(() => {});

    expect(prisma.userOrg.count).toHaveBeenCalledWith({ where: { orgId: 'org-1', role: 'ADMIN' } });
  });

  it('lets the last admin stay an admin', async () => {
    // Re-saving ADMIN is not a demotion and must not be refused.
    prisma.userOrg.findUnique.mockResolvedValue({ role: 'ADMIN' });
    prisma.userOrg.count.mockResolvedValue(1);

    expect(await service.updateMemberRole('org-1', 'u1', 'ADMIN')).toEqual({ role: 'ADMIN' });
  });

  it('refuses somebody who is not a member', async () => {
    prisma.userOrg.findUnique.mockResolvedValue(null);

    await expect(service.updateMemberRole('org-1', 'u1', 'ADMIN')).rejects.toThrow(NotFoundException);
  });
});
