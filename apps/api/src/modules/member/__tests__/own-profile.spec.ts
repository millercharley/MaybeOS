import { MemberService } from '../member.service';
import { NotFoundException } from '@nestjs/common';

/**
 * A member editing their own entry, and nobody else's.
 *
 * The directory could show a biography long before anything could write one:
 * `UserOrg.bio` has been in the schema since it was drawn and no route ever
 * set it, so every profile was empty by construction.
 *
 * The shape of the route is the safeguard. There is no `:userId` — the id
 * comes from the token — so there is no way to aim this at another member
 * however it is called. That is worth a test rather than a comment, because
 * the obvious "improvement" later is to add a userId parameter for admins.
 */
describe('MemberService — your own profile', () => {
  const build = () => {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      userOrg: {
        findUnique: jest.fn().mockResolvedValue({ id: 'uo-1' }),
        update: (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push({ where: args.where, data: args.data });
          return { id: 'uo-1', ...args.data };
        },
      },
    };
    return {
      service: new MemberService(prisma as never, {} as never, {} as never, {} as never),
      prisma,
      updates,
    };
  };

  it('writes against the caller’s own membership', async () => {
    const { service, updates } = build();

    await service.updateMyMembership('org-1', 'user-1', { bio: 'Potter.' });

    expect(updates[0].where).toEqual({ userId_orgId: { userId: 'user-1', orgId: 'org-1' } });
  });

  it('saves the biography', async () => {
    const { service, updates } = build();

    await service.updateMyMembership('org-1', 'user-1', { bio: '  Gardener.  ' });

    expect((updates[0].data as { bio: string }).bio).toBe('Gardener.');
  });

  it('clears a biography rather than storing whitespace', async () => {
    // Otherwise the directory shows an empty paragraph instead of the "hasn't
    // written an introduction yet" line.
    const { service, updates } = build();

    await service.updateMyMembership('org-1', 'user-1', { bio: '   ' });

    expect((updates[0].data as { bio: string | null }).bio).toBeNull();
  });

  it('drops empty tags', async () => {
    const { service, updates } = build();

    await service.updateMyMembership('org-1', 'user-1', { tags: ['ceramics', '  ', ' wood '] });

    expect((updates[0].data as { tags: string[] }).tags).toEqual(['ceramics', 'wood']);
  });

  it('leaves untouched fields alone', async () => {
    // A member editing their biography must not blank their tags.
    const { service, updates } = build();

    await service.updateMyMembership('org-1', 'user-1', { bio: 'Just this.' });

    expect(updates[0].data).not.toHaveProperty('tags');
  });

  it('refuses somebody who is not in the co-op', async () => {
    const { service, prisma } = build();
    prisma.userOrg.findUnique.mockResolvedValue(null);

    await expect(
      service.updateMyMembership('org-1', 'stranger', { bio: 'hello' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
