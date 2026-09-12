import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';
import { UpdateOrgDto } from '../../org/dto/update-org.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * Members opening channels, sections, emoji and invitations (CMN-11).
 *
 * The switch is the part worth testing hardest: it is off for every co-op
 * that exists, and "off" has to mean a member is refused rather than a member
 * quietly succeeding because a decorator was dropped from the route. The old
 * `@Roles('ADMIN')` is gone from `POST channels`, so this service check is the
 * only thing standing between a member and a channel.
 */
describe('CommonsService — member channels, sections and invitations', () => {
  let service: CommonsService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const ADMIN = 'admin-1';
  const MEMBER = 'member-1';
  const OTHER_MEMBER = 'member-2';

  /** A co-op with the switch in a given position. */
  const coop = (memberChannelsEnabled: boolean) =>
    prisma.organization.findUnique.mockResolvedValue({
      memberChannelsEnabled,
      slug: 'test-coop',
    } as never);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        {
          provide: PrismaService,
          useValue: {
            organization: { findUnique: jest.fn() },
            channel: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
            },
            channelSection: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              delete: jest.fn().mockResolvedValue({}),
            },
            post: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
            directMessage: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
            userOrg: { findFirst: jest.fn().mockResolvedValue({ id: 'membership' }) },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<CommonsService>(CommonsService);
    prisma = module.get(PrismaService);
  });

  describe('who may open a channel', () => {
    it('refuses a member while the co-op has not turned it on', async () => {
      coop(false);

      await expect(
        service.createChannel(ORG, { name: 'Cycling' } as never, MEMBER, 'MEMBER'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.channel.create).not.toHaveBeenCalled();
    });

    it('lets a member open one once it is on', async () => {
      coop(true);

      const created = await service.createChannel(ORG, { name: 'Cycling' } as never, MEMBER, 'MEMBER');

      expect(created.name).toBe('Cycling');
      // Recorded, so the member can rename it later without an admin.
      expect(created.createdById).toBe(MEMBER);
    });

    it('lets an admin open one without reading the switch at all', async () => {
      // Deliberately left unset: an admin creating a channel must not depend
      // on a co-op setting, and this proves the check short-circuits.
      prisma.organization.findUnique.mockResolvedValue(null as never);

      await expect(
        service.createChannel(ORG, { name: 'Announcements' } as never, ADMIN, 'ADMIN'),
      ).resolves.toMatchObject({ name: 'Announcements' });
    });

    it('refuses a caller with no role in the org even when it is on', async () => {
      // A role of undefined is not a member. `OrgMembershipGuard` should have
      // stopped this already; the service does not assume it did.
      coop(false);

      await expect(
        service.createChannel(ORG, { name: 'Cycling' } as never, MEMBER, undefined),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('changing a channel', () => {
    const channelBy = (createdById: string | null) =>
      prisma.channel.findFirst.mockResolvedValue({ id: 'c1', createdById } as never);

    it('lets the member who opened it rename it', async () => {
      channelBy(MEMBER);
      prisma.channel.findFirst
        .mockResolvedValueOnce({ id: 'c1', createdById: MEMBER } as never)
        .mockResolvedValue(null); // the slug is free

      await expect(
        service.updateChannel(ORG, 'c1', { name: 'Cycling club' }, MEMBER, 'MEMBER'),
      ).resolves.toMatchObject({ name: 'Cycling club' });
    });

    it('refuses a different member', async () => {
      channelBy(MEMBER);

      await expect(
        service.updateChannel(ORG, 'c1', { name: 'Mine now' }, OTHER_MEMBER, 'MEMBER'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets an admin change a channel somebody else opened', async () => {
      prisma.channel.findFirst
        .mockResolvedValueOnce({ id: 'c1', createdById: MEMBER } as never)
        .mockResolvedValue(null);

      await expect(
        service.updateChannel(ORG, 'c1', { emoji: '🚲' }, ADMIN, 'ADMIN'),
      ).resolves.toMatchObject({ emoji: '🚲' });
    });

    it('clears the emoji when given an empty string, the same as null', async () => {
      channelBy(ADMIN);

      const updated = await service.updateChannel(ORG, 'c1', { emoji: '' }, ADMIN, 'ADMIN');

      expect(updated.emoji).toBeNull();
    });

    it('will not file a channel under another co-op’s section', async () => {
      channelBy(ADMIN);
      prisma.channelSection.findFirst.mockResolvedValue(null); // not in this org

      await expect(
        service.updateChannel(ORG, 'c1', { sectionId: 'section-elsewhere' }, ADMIN, 'ADMIN'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sections', () => {
    it('refuses a second section of the same name with a sentence, not a 500', async () => {
      // `(orgId, name)` is unique, so this is a Prisma error unless caught —
      // the bug channel slugs had before CMN-10.
      prisma.channelSection.findFirst.mockResolvedValue({ id: 'existing' } as never);

      await expect(service.createSection(ORG, 'General')).rejects.toThrow(BadRequestException);
    });

    it('keeps the channels when a section is deleted', async () => {
      prisma.channelSection.findFirst.mockResolvedValue({ id: 's1' } as never);
      prisma.channel.count.mockResolvedValue(3);

      const result = await service.deleteSection(ORG, 's1');

      // The heading goes; the conversations under it do not.
      expect(result).toEqual({ deleted: 's1', ungrouped: 3 });
      expect(prisma.channelSection.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('refuses a blank name', async () => {
      await expect(service.createSection(ORG, '   ')).rejects.toThrow(BadRequestException);
    });
  });

  describe('inviting members to a channel', () => {
    beforeEach(() => {
      prisma.channel.findFirst.mockResolvedValue({ id: 'c1', name: 'Cycling', emoji: '🚲' } as never);
      coop(true);
    });

    it('sends one message per member, from the person inviting', async () => {
      const result = await service.inviteToChannel(ORG, 'c1', MEMBER, [OTHER_MEMBER, 'member-3']);

      expect(result).toEqual({ invited: 2, channelId: 'c1' });
      const { data } = (prisma.directMessage.createMany as jest.Mock).mock.calls[0][0];
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ orgId: ORG, senderId: MEMBER, receiverId: OTHER_MEMBER });
      expect(data[0].body).toContain('/portal/test-coop/commons?channel=c1');
    });

    it('drops the inviter from their own invitation list', async () => {
      const result = await service.inviteToChannel(ORG, 'c1', MEMBER, [MEMBER, OTHER_MEMBER]);

      expect(result.invited).toBe(1);
    });

    it('refuses an invitation addressed only to yourself', async () => {
      await expect(service.inviteToChannel(ORG, 'c1', MEMBER, [MEMBER])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses somebody who is not in this co-op', async () => {
      // A user id in a request body is not evidence of membership. Without
      // this, an invitation is a way to message any user in the system.
      prisma.userOrg.findFirst.mockResolvedValue(null);

      await expect(
        service.inviteToChannel(ORG, 'c1', MEMBER, ['stranger']),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.directMessage.createMany).not.toHaveBeenCalled();
    });

    it('escapes a channel name that contains markup', async () => {
      // The name is written by a member and the body is stored as HTML.
      prisma.channel.findFirst.mockResolvedValue({
        id: 'c1',
        name: '<img src=x onerror=alert(1)>',
        emoji: null,
      } as never);

      await service.inviteToChannel(ORG, 'c1', MEMBER, [OTHER_MEMBER]);

      const { data } = (prisma.directMessage.createMany as jest.Mock).mock.calls[0][0];
      expect(data[0].body).not.toContain('<img');
      expect(data[0].body).toContain('&lt;img');
    });

    it('escapes the note as well as the name', async () => {
      await service.inviteToChannel(ORG, 'c1', MEMBER, [OTHER_MEMBER], '<script>bad()</script>');

      const { data } = (prisma.directMessage.createMany as jest.Mock).mock.calls[0][0];
      expect(data[0].body).not.toContain('<script>');
    });
  });

  describe('the shape a page of posts comes back in', () => {
    it('uses the same envelope as every other paginated endpoint', async () => {
      // It used to answer `{ data, total, page, perPage }` while the web
      // client's `PaginatedResponse` declared `{ data, meta: {...} }`. Nothing
      // read the count until the channel view needed to know whether there
      // are older messages to fetch (CMN-11) — and a mismatch like this does
      // not throw, it renders a zero.
      prisma.channel.findFirst.mockResolvedValue({ id: 'c1' } as never);
      (prisma.$transaction as jest.Mock).mockResolvedValue([[{ id: 'p1' }], 41]);

      const page = await service.listPosts(ORG, 'c1', 1, 20);

      expect(page.meta).toEqual({ page: 1, perPage: 20, total: 41, totalPages: 3 });
      expect(page.data).toHaveLength(1);
    });
  });

  describe('what the caller is told they may do', () => {
    it('says a member may not create while the switch is off', async () => {
      coop(false);

      await expect(service.commonsPermissions(ORG, 'MEMBER')).resolves.toEqual({
        memberChannelsEnabled: false,
        canCreateChannel: false,
        canManageSections: false,
      });
    });

    it('says an admin may, either way', async () => {
      coop(false);

      await expect(service.commonsPermissions(ORG, 'ADMIN')).resolves.toMatchObject({
        canCreateChannel: true,
        canManageSections: true,
      });
    });
  });
});

/**
 * The bodies these forms actually send, through the exact pipe production
 * uses. `forbidNonWhitelisted` rejects the whole request over one undeclared
 * field — which is how every event edit failed for nine days (EVT-21) — so a
 * new field is not shipped until a test has sent it.
 */
describe('CMN-11 fields through the validation whitelist', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);
  const asDto = (metatype: unknown) => (body: object) =>
    pipe.transform(body, { type: 'body', metatype: metatype as never });

  const createChannel = asDto(CreateChannelDto);
  const updateChannel = asDto(UpdateChannelDto);
  const updateOrg = asDto(UpdateOrgDto);

  it('accepts the member-channels switch on the Settings form', async () => {
    await expect(updateOrg({ memberChannelsEnabled: true })).resolves.toMatchObject({
      memberChannelsEnabled: true,
    });
  });

  it('accepts a channel with an emoji and a section', async () => {
    await expect(
      createChannel({ name: 'Cycling', emoji: '🚲', sectionId: '3f0e9d4a-3a5f-4c2e-9a1e-2b6d5c7f8a90' }),
    ).resolves.toMatchObject({ emoji: '🚲' });
  });

  it('accepts a flag and a family, which are several code points each', async () => {
    // A "single emoji" is not a single character. 🇺🇸 is two regional
    // indicators and 👨‍👩‍👧‍👦 is four pictographs joined by zero-width joiners;
    // a naive length check refuses both.
    await expect(createChannel({ name: 'Trips', emoji: '🇺🇸' })).resolves.toBeDefined();
    await expect(createChannel({ name: 'Families', emoji: '👨‍👩‍👧‍👦' })).resolves.toBeDefined();
  });

  it('refuses a word typed into the emoji box', async () => {
    await expect(createChannel({ name: 'General', emoji: 'General' })).rejects.toThrow();
  });

  it('refuses punctuation on its own', async () => {
    await expect(createChannel({ name: 'General', emoji: '!!!' })).rejects.toThrow();
  });

  it('lets an edit clear the emoji and ungroup the channel', async () => {
    await expect(updateChannel({ emoji: null, sectionId: null })).resolves.toMatchObject({
      emoji: null,
      sectionId: null,
    });
  });
});
