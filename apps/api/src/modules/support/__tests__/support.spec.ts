import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SupportService } from '../support.service';
import { SupportController } from '../support.controller';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { SUPPORT_ARTICLES } from '../support-articles';

/**
 * MaybeOS's own documentation (PLT-05).
 *
 * Two audiences and one body of text: every co-op's organisers read it, only
 * a platform admin writes it. Most of what can go wrong here is that
 * asymmetry going wrong in one direction or the other.
 */
describe('SupportService', () => {
  const build = async (over: { existing?: { slug: string }[]; count?: number } = {}) => {
    const prisma = {
      supportArticle: {
        count: jest.fn().mockResolvedValue(over.count ?? 1),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 2 } }),
      },
      supportArticleImage: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'i1', caption: null }),
        delete: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _max: { position: 0 } }),
      },
    };
    prisma.supportArticle.findMany.mockResolvedValue(over.existing ?? []);

    const storage = {
      uploadSupportImage: jest.fn().mockResolvedValue('platform/support/x.png'),
      signedAttachmentUrl: jest.fn().mockResolvedValue('https://signed/x.png'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    return { service: module.get(SupportService), prisma, storage };
  };

  describe('the documentation that ships', () => {
    it('puts every shipped article in, the first time', async () => {
      const { service, prisma } = await build({ existing: [] });

      const { added } = await service.seed();

      expect(added).toBe(SUPPORT_ARTICLES.length);
      expect(added).toBeGreaterThan(5);
      expect(prisma.supportArticle.createMany).toHaveBeenCalled();
    });

    it('never overwrites an article somebody has corrected', async () => {
      /*
        The whole reason seeding is by slug. A platform admin who fixes a
        page was looking at the product when they fixed it; the file in the
        repository was not.
      */
      const { service, prisma } = await build({
        existing: SUPPORT_ARTICLES.map((a) => ({ slug: a.slug })),
      });

      await expect(service.seed()).resolves.toEqual({ added: 0 });
      expect(prisma.supportArticle.createMany).not.toHaveBeenCalled();
    });

    it('adds only what is new when an article ships later', async () => {
      const { service, prisma } = await build({
        existing: SUPPORT_ARTICLES.slice(1).map((a) => ({ slug: a.slug })),
      });

      const { added } = await service.seed();

      expect(added).toBe(1);
      const written = prisma.supportArticle.createMany.mock.calls[0][0].data;
      expect(written[0].slug).toBe(SUPPORT_ARTICLES[0].slug);
    });

    it('seeds as the module comes up, so nobody has to open anything', async () => {
      /*
        This was lazy — seeded on the first read — and the cost only became
        obvious at deploy: the first read is an *authenticated* one, so
        nothing existed until an organiser opened the page, and a deploy could
        not be confirmed without signing in as somebody.
      */
      const { service, prisma } = await build({ existing: [] });

      service.onModuleInit();
      await new Promise((r) => setImmediate(r));

      expect(prisma.supportArticle.createMany).toHaveBeenCalled();
    });

    it('does not take the API down when seeding fails', async () => {
      // Documentation arriving late is a nuisance; an API that will not boot
      // is an outage.
      const { service, prisma } = await build({ existing: [] });
      prisma.supportArticle.findMany.mockRejectedValue(new Error('no database yet'));

      expect(() => service.onModuleInit()).not.toThrow();
      await new Promise((r) => setImmediate(r));
    });

    it('still fills an empty shelf on read, if the boot seed could not run', async () => {
      const { service, prisma } = await build({ count: 0, existing: [] });

      await service.list(false);

      expect(prisma.supportArticle.createMany).toHaveBeenCalled();
    });
  });

  describe('who sees what', () => {
    it('hides drafts from an organiser', async () => {
      const { service, prisma } = await build();

      await service.list(false);

      expect(prisma.supportArticle.findMany.mock.calls.at(-1)?.[0].where).toEqual({
        state: 'PUBLISHED',
      });
    });

    it('shows drafts to a platform admin, who is writing them', async () => {
      const { service, prisma } = await build();

      await service.list(true);

      expect(prisma.supportArticle.findMany.mock.calls.at(-1)?.[0].where).toEqual({});
    });

    it('will not open a draft by its address either', async () => {
      const { service } = await build();

      await expect(service.get('half-written', false)).rejects.toThrow(NotFoundException);
    });
  });

  describe('screenshots', () => {
    it('stores them privately, not on a public URL', async () => {
      // A picture of an admin screen is still a picture of somebody's admin
      // screen.
      const { service, prisma, storage } = await build();
      prisma.supportArticle.findUnique.mockResolvedValue({ id: 'a1' });

      await service.addImage('a1', 'data:image/png;base64,AAAA', 'image/png');

      expect(storage.uploadSupportImage).toHaveBeenCalled();
      expect(storage.signedAttachmentUrl).toHaveBeenCalledWith('platform/support/x.png');
    });

    it('takes a data URL or bare base64, because browsers give both', async () => {
      const { service, prisma, storage } = await build();
      prisma.supportArticle.findUnique.mockResolvedValue({ id: 'a1' });

      await service.addImage('a1', 'AAAA', 'image/png');
      const [bytes] = storage.uploadSupportImage.mock.calls[0];

      expect(Buffer.isBuffer(bytes)).toBe(true);
    });

    it('refuses to remove a screenshot from another article', async () => {
      // The id comes from the URL (SEC-04).
      const { service } = await build();

      await expect(service.removeImage('a1', 'someone-elses')).rejects.toThrow(NotFoundException);
    });
  });

  describe('slugs', () => {
    it('makes a readable one from the title', async () => {
      const { service, prisma } = await build();

      await service.create('u1', { title: 'Door codes & you', category: 'x', body: '<p>b</p>' });

      expect(prisma.supportArticle.create.mock.calls[0][0].data.slug).toBe('door-codes-you');
    });

    it('does not collide with one that exists', async () => {
      const { service, prisma } = await build();
      prisma.supportArticle.findUnique
        .mockResolvedValueOnce({ id: 'taken' })
        .mockResolvedValue(null);

      await service.create('u1', { title: 'Door codes', category: 'x', body: '<p>b</p>' });

      expect(prisma.supportArticle.create.mock.calls[0][0].data.slug).toBe('door-codes-2');
    });
  });
});

/**
 * The controller, where the asymmetry lives: reading needs an account,
 * writing needs a platform admin.
 */
describe('SupportController', () => {
  const service = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({}),
  };
  const controller = new SupportController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('tells the service whether this reader may edit', () => {
    controller.list({ userId: 'u1', globalRole: 'PLATFORM_ADMIN' } as never);
    expect(service.list).toHaveBeenCalledWith(true);

    controller.list({ userId: 'u2', globalRole: 'USER' } as never);
    expect(service.list).toHaveBeenCalledWith(false);
  });

  it('is not locked to platform admins at the controller', () => {
    /*
      Charley: "All Admins should see this documentation." A
      controller-level PlatformAdminGuard would lock out the four hundred
      organisers this is written for, which is why the guard sits on the write
      routes one at a time.
    */
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'support.controller.ts'),
      'utf8',
    );
    const header = source.slice(0, source.indexOf('export class'));

    expect(header).toContain('@UseGuards(JwtAuthGuard)');
    expect(header).not.toContain('@UseGuards(JwtAuthGuard, PlatformAdminGuard)');
  });

  it('guards every write with the platform admin check', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'support.controller.ts'),
      'utf8',
    );

    for (const route of ['@Post(', '@Patch(', '@Delete(']) {
      let from = source.indexOf(route);
      while (from !== -1) {
        // The decorator block between this route and its handler body.
        const block = source.slice(from, source.indexOf('{', source.indexOf(')', from)));
        expect(block).toContain('PlatformAdminGuard');
        from = source.indexOf(route, from + 1);
      }
    }
  });
});
