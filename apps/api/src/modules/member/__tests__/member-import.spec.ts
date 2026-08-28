import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MemberService, safeLinks } from '../member.service';
import { PrismaService } from '../../../config/prisma.service';
import { EmailService } from '../../email/email.service';
import { StripeService } from '../../stripe/stripe.service';
import { StorageService } from '../../storage/storage.service';
import { BuddyService } from '../../belonging/buddy.service';

/**
 * Importing an existing community (MEM-06).
 *
 * The behaviour worth pinning down is what the importer refuses to do. A
 * co-op's own organiser is normally row one of their own export — Charley is,
 * in MaybeItsFate's — so an importer that "helpfully" refreshed existing
 * records would demote the owner of the co-op running the import.
 */
describe('MemberService — importing a community', () => {
  let service: MemberService;
  let prisma: any;
  let storage: any;

  const email = 'maya@example.org';

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'user-1', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      userOrg: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    storage = { importAvatarFromUrl: jest.fn().mockResolvedValue('user-1/abc.jpg') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemberService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'https://maybeos.org' } },
        { provide: StripeService, useValue: {} },
        { provide: StorageService, useValue: storage },
        // Never reached here: the buddy search is fire-and-forget and off by default.
        { provide: BuddyService, useValue: { onMemberJoined: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    service = module.get<MemberService>(MemberService);
  });

  describe('what it refuses to overwrite', () => {
    it('leaves an existing membership completely alone', async () => {
      // The owner of the co-op, already here, sitting in row one of the file.
      prisma.user.findUnique.mockResolvedValue({ id: 'owner-1', avatarUrl: null });
      prisma.userOrg.findUnique.mockResolvedValue({ id: 'membership-1' });

      const result = await service.importMembers('org-1', [
        { email, name: 'Someone Else', bio: 'from the old platform' },
      ]);

      expect(result.alreadyMembers).toBe(1);
      expect(result.created).toBe(0);
      // The two calls that would have demoted an OWNER to MEMBER, or replaced
      // a curated profile with whatever the export held.
      expect(prisma.userOrg.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('joins an existing MaybeOS account without rewriting it', async () => {
      // Somebody who already has an account through another co-op.
      prisma.user.findUnique.mockResolvedValue({ id: 'user-9', avatarUrl: null });

      const result = await service.importMembers('org-1', [
        { email, name: 'Different Name', avatarUrl: 'https://old.example/a.jpg' },
      ]);

      expect(result.linkedExistingUsers).toBe(1);
      expect(result.created).toBe(1);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.userOrg.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-9', role: 'MEMBER' }) }),
      );
    });
  });

  describe('what it carries across', () => {
    it('keeps the date they actually joined, not the date of the import', async () => {
      await service.importMembers('org-1', [{ email, joinedAt: '2023-09-22T18:45:04.000Z' }]);

      const { data } = prisma.userOrg.create.mock.calls[0][0];
      expect(data.memberSince).toEqual(new Date('2023-09-22T18:45:04.000Z'));
    });

    it('falls back to the column default when the export had no join date', async () => {
      await service.importMembers('org-1', [{ email }]);

      const { data } = prisma.userOrg.create.mock.calls[0][0];
      expect(data).not.toHaveProperty('memberSince');
    });

    it('records an opt-out, and leaves "never asked" as null', async () => {
      await service.importMembers('org-1', [
        { email: 'out@example.org', emailOptIn: false },
        { email: 'unknown@example.org' },
      ]);

      expect(prisma.userOrg.create.mock.calls[0][0].data.emailOptIn).toBe(false);
      // Absent, not false: nobody put the question to this person, and a
      // default would record a refusal they never made.
      expect(prisma.userOrg.create.mock.calls[1][0].data).not.toHaveProperty('emailOptIn');
    });

    it('creates imported accounts with no password and unverified', async () => {
      await service.importMembers('org-1', [{ email, name: 'Maya' }]);

      const { data } = prisma.user.create.mock.calls[0][0];
      expect(data.passwordHash).toBeUndefined();
      expect(data.emailVerified).toBeUndefined();
    });

    it('reports a bad row without abandoning the rest of the file', async () => {
      prisma.userOrg.create
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({});

      const result = await service.importMembers('org-1', [
        { email: 'bad@example.org' },
        { email: 'good@example.org' },
      ]);

      expect(result.created).toBe(1);
      expect(result.errors).toEqual([{ email: 'bad@example.org', reason: 'boom' }]);
    });
  });

  describe('profile links', () => {
    it('drops anything that is not http or https', () => {
      expect(
        safeLinks([
          'https://example.org',
          'http://example.org',
          // eslint-disable-next-line no-script-url
          'javascript:alert(document.cookie)',
          'data:text/html,<script>1</script>',
          'not a url',
          '  ',
        ]),
      ).toEqual(['https://example.org', 'http://example.org']);
    });

    it('filters on the way into an import, not only at render time', async () => {
      await service.importMembers('org-1', [
        // eslint-disable-next-line no-script-url
        { email, links: ['https://ok.example', 'javascript:alert(1)'] },
      ]);

      expect(prisma.userOrg.create.mock.calls[0][0].data.links).toEqual(['https://ok.example']);
    });
  });

  describe('copying avatars across', () => {
    const membership = (id: string, userId: string) => ({
      id,
      user: { id: userId, avatarUrl: 'https://old.example/a.jpg' },
    });

    it('walks forward by cursor so a failure is passed over, not retried forever', async () => {
      prisma.userOrg.findMany.mockResolvedValue([membership('m-1', 'u-1')]);
      prisma.userOrg.count.mockResolvedValue(7);
      storage.importAvatarFromUrl.mockResolvedValue(null); // every fetch fails

      const result = await service.importAvatars('org-1', { limit: 1 });

      expect(result.failed).toBe(1);
      expect(result.imported).toBe(0);
      // The cursor still advances, so the next call asks about the *next*
      // member rather than the one that just failed.
      expect(result.lastId).toBe('m-1');
      expect(result.remaining).toBe(7);
    });

    it('records where MaybeOS put the file, not where it came from', async () => {
      prisma.userOrg.findMany.mockResolvedValue([membership('m-1', 'u-1')]);
      storage.importAvatarFromUrl.mockResolvedValue('u-1/copied.jpg');

      const result = await service.importAvatars('org-1', { limit: 8 });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { avatarPath: 'u-1/copied.jpg' },
      });
      expect(result.imported).toBe(1);
      expect(result.done).toBe(true);
    });
  });
});
