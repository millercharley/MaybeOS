import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { OrgService } from '../org.service';
import { ForumService } from '../forum.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';

/**
 * Where the co-op is (ORG-01).
 *
 * The interesting behaviour is the refusal. Both foreign keys are `SET NULL`,
 * so deleting a location that is in use would succeed *silently* and blank the
 * venue on every room and event that named it — including past events, whose
 * record of where they happened would be quietly rewritten.
 */
describe('OrgService — locations', () => {
  let service: OrgService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org-1' }) },
      location: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'loc-1' }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => ({ id: 'loc-1', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'loc-1', ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      room: { count: jest.fn().mockResolvedValue(0) },
      event: { count: jest.fn().mockResolvedValue(0) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgService,
        { provide: ForumService, useValue: { autoJoin: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        // OrgService also uploads logos; locations touch none of that.
        { provide: StorageService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrgService>(OrgService);
  });

  describe('deleting', () => {
    it('refuses while a room still names it, and says how many', async () => {
      prisma.room.count.mockResolvedValue(2);

      await expect(service.removeLocation('org-1', 'loc-1')).rejects.toThrow(ConflictException);
      await expect(service.removeLocation('org-1', 'loc-1')).rejects.toThrow(/2 rooms/);
      expect(prisma.location.delete).not.toHaveBeenCalled();
    });

    it('refuses while an event still names it, past events included', async () => {
      // A past event's record of where it happened is not ours to rewrite.
      prisma.event.count.mockResolvedValue(1);

      await expect(service.removeLocation('org-1', 'loc-1')).rejects.toThrow(/1 event/);
    });

    it('counts both in one sentence', async () => {
      prisma.room.count.mockResolvedValue(3);
      prisma.event.count.mockResolvedValue(4);

      await expect(service.removeLocation('org-1', 'loc-1')).rejects.toThrow(/3 rooms and 4 events/);
    });

    it('deletes one nothing points at', async () => {
      await expect(service.removeLocation('org-1', 'loc-1')).resolves.toEqual({ removed: true });
      expect(prisma.location.delete).toHaveBeenCalled();
    });

    it('will not reach into another co-op', async () => {
      // Resolved through its org, never by bare id (SEC-04).
      prisma.location.findFirst.mockResolvedValue(null);

      await expect(service.removeLocation('org-1', 'loc-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('adding', () => {
    it('makes the first one the default', async () => {
      // A co-op with a single address never has to think about the concept.
      const created = await service.addLocation('org-1', { name: 'Butchertown Hall' });

      expect(created.isDefault).toBe(true);
    });

    it('does not make the second one the default', async () => {
      prisma.location.count.mockResolvedValue(1);

      const created = await service.addLocation('org-1', { name: 'The Annex' });

      expect(created.isDefault).toBe(false);
    });

    it('trims, and keeps a sensible country and timezone', async () => {
      const created = await service.addLocation('org-1', { name: '  Hall  ' });

      expect(created.name).toBe('Hall');
      expect(created.country).toBe('US');
      expect(created.timezone).toBe('America/New_York');
    });
  });
});
