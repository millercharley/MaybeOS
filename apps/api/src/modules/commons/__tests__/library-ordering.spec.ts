import { CommonsService } from '../commons.service';

/**
 * A library is a sequence, not a set.
 *
 * MaybeItsFate's Member Handbook runs "0. You BELONG", "1. Code of Conduct",
 * "2. Building Access" — the order is the document. `sortOrder` has been on
 * both models since the wiki was built and the list has always been ordered by
 * it, but no request could set it: neither DTO accepted the field, so every
 * collection and every page was created at 0 and fell back to insertion order.
 *
 * Two rules worth holding still:
 *   1. a new thing appends rather than landing at the top
 *   2. an explicit position is honoured, which is what reordering needs
 */
describe('CommonsService — library ordering', () => {
  const build = () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      collection: {
        findFirst: jest.fn().mockResolvedValue({ sortOrder: 4 }),
        create: (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'c1', ...args.data };
        },
      },
      collectionPage: {
        findFirst: jest.fn().mockResolvedValue({ sortOrder: 2 }),
        create: (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return { id: 'p1', ...args.data };
        },
      },
    };
    return {
      service: new CommonsService(prisma as never, {} as never, {} as never),
      created,
      prisma,
    };
  };

  it('appends a new collection after the last one', async () => {
    const { service, created } = build();
    await service.createCollection('org-1', { name: 'Member Handbook' } as never);

    expect(created[0].sortOrder).toBe(5);
  });

  it('appends a new page after the last in its collection', async () => {
    const { service, created } = build();
    await service.createPage('org-1', 'c1', 'user-1', {
      title: '2. Building Access',
      body: '<p>Door codes.</p>',
    } as never);

    expect(created[0].sortOrder).toBe(3);
  });

  it('starts at zero when a co-op has nothing yet', async () => {
    const { service, created, prisma } = build();
    prisma.collection.findFirst.mockResolvedValue(null);

    await service.createCollection('org-1', { name: 'First' } as never);

    expect(created[0].sortOrder).toBe(0);
  });

  it('honours an explicit position, which is what reordering sends', async () => {
    const { service, created } = build();
    await service.createPage('org-1', 'c1', 'user-1', {
      title: '0. You BELONG',
      body: '<p>Welcome.</p>',
      sortOrder: 0,
    } as never);

    // Not 3: a caller that names a position means it, and swapping two pages
    // is exactly that.
    expect(created[0].sortOrder).toBe(0);
  });
});
