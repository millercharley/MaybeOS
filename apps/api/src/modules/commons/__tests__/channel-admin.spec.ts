import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * An admin arranging the co-op's Commons (CMN-10).
 *
 * Creating a channel used to be a seed-script job, so its slug was derived
 * from the name and written straight in. Now that it is a form an organiser
 * fills in, the cases below are things people will actually do on a Tuesday —
 * and every one of them used to be a 500 or a lost conversation.
 */
describe('CommonsService — channels', () => {
  let service: CommonsService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        {
          provide: PrismaService,
          useValue: {
            channel: {
              findFirst: jest.fn(),
              findMany: jest.fn().mockResolvedValue([]),
              create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              update: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
              updateMany: jest.fn(),
              delete: jest.fn().mockResolvedValue({}),
            },
            $transaction: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<CommonsService>(CommonsService);
    prisma = module.get(PrismaService);
  });

  describe('creating one', () => {
    it('gives a second channel of the same name its own slug', async () => {
      // `(orgId, slug)` is unique. A co-op that already has "General" and
      // makes another used to get a Prisma unique violation as a 500.
      prisma.channel.findFirst
        .mockResolvedValueOnce({ id: 'existing' } as never) // "general" taken
        .mockResolvedValueOnce(null) // "general-2" free
        .mockResolvedValueOnce(null); // the position lookup

      const created = await service.createChannel(ORG, { name: 'General' } as never);

      expect(created.slug).toBe('general-2');
    });

    it('still produces a slug for a name that is all punctuation', async () => {
      // "???" flattens to an empty string, which looks like a legal slug and
      // then collides with the next one that does the same.
      prisma.channel.findFirst.mockResolvedValue(null);

      const created = await service.createChannel(ORG, { name: '???' } as never);

      expect(created.slug).toBe('channel');
    });

    it('appends rather than jumping to the top', async () => {
      prisma.channel.findFirst
        .mockResolvedValueOnce(null) // slug is free
        .mockResolvedValueOnce({ position: 4 } as never); // the last channel

      const created = await service.createChannel(ORG, { name: 'New' } as never);

      expect(created.position).toBe(5);
    });
  });

  describe('renaming one', () => {
    it('moves the slug with the name', async () => {
      // A channel renamed to "Announcements" whose address still said `random`
      // would be a small lie in every link to it.
      prisma.channel.findFirst
        .mockResolvedValueOnce({ id: 'c1', orgId: ORG } as never) // the scoped lookup
        .mockResolvedValueOnce(null); // the new slug is free

      const updated = await service.updateChannel(ORG, 'c1', { name: 'Announcements' });

      expect(updated).toMatchObject({ name: 'Announcements', slug: 'announcements' });
    });

    it('refuses a name of nothing but spaces', async () => {
      prisma.channel.findFirst.mockResolvedValue({ id: 'c1', orgId: ORG } as never);

      await expect(service.updateChannel(ORG, 'c1', { name: '   ' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.channel.update).not.toHaveBeenCalled();
    });
  });

  describe('deleting one', () => {
    it('refuses the default channel', async () => {
      // Posts cascade off a channel, and the default is where anything without
      // a home lands. Deleting it leaves the Commons with no floor.
      prisma.channel.findFirst.mockResolvedValue({
        id: 'c1',
        orgId: ORG,
        isDefault: true,
      } as never);

      await expect(service.deleteChannel(ORG, 'c1')).rejects.toThrow(BadRequestException);
      expect(prisma.channel.delete).not.toHaveBeenCalled();
    });

    it('deletes an ordinary one', async () => {
      prisma.channel.findFirst.mockResolvedValue({
        id: 'c2',
        orgId: ORG,
        isDefault: false,
      } as never);

      await expect(service.deleteChannel(ORG, 'c2')).resolves.toEqual({ deleted: 'c2' });
    });
  });

  describe('reordering', () => {
    it('scopes every write to this co-op', async () => {
      // The list of ids comes from a browser. A doctored one must not
      // renumber another co-op's Commons.
      await service.reorderChannels(ORG, ['a', 'b']);

      expect(prisma.channel.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', orgId: ORG },
        data: { position: 0 },
      });
      expect(prisma.channel.updateMany).toHaveBeenCalledWith({
        where: { id: 'b', orgId: ORG },
        data: { position: 1 },
      });
    });

    it('writes the whole order at once', async () => {
      // One transaction, so two admins dragging at the same time cannot leave
      // two channels claiming the same position.
      await service.reorderChannels(ORG, ['a', 'b', 'c']);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
