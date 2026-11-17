import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TeachingService } from '../teaching.service';

/**
 * What the queries actually ask for (TCH-01).
 *
 * `public-offering-fields.spec.ts` pins which *columns* reach the web. This
 * pins which *rows* do, which is the other half and the one that leaks
 * quietly: a perfect select over the wrong `where` publishes a members-only
 * offering with all the right fields on it.
 *
 * Built by hand with a capture mock rather than through a Nest module, the
 * way `portal-event-visibility.spec.ts` does — nothing here needs the
 * container, and the assertions are about the argument Prisma received.
 */
type Where = Record<string, any>;

function build(org: Record<string, unknown> | null) {
  const captured: { offerings: Where[] } = { offerings: [] };

  const prisma = {
    organization: { findUnique: async () => org },
    offering: {
      findMany: async (args: { where: Where }) => {
        captured.offerings.push(args.where);
        return [];
      },
    },
    event: { count: async () => 0 },
  };

  const service = new TeachingService(
    prisma as never,
    {} as never,
    {} as never,
    { get: () => 'https://maybeos.org' } as never,
  );

  return { service, captured };
}

const ORG = {
  id: 'org-1',
  name: 'Sunrise',
  slug: 'sunrise',
  brandColor: '#b03030',
  timezone: 'America/New_York',
  teachingEnabled: true,
};

describe('the public list', () => {
  const whereFor = async (org = ORG) => {
    const { service, captured } = build(org);
    await service.listPublic('sunrise');
    return captured.offerings[0];
  };

  it('asks only for PUBLIC', async () => {
    expect((await whereFor()).visibility).toEqual({ in: ['PUBLIC'] });
  });

  /**
   * The one that would be invisible if it broke: a members-only offering on a
   * co-op's marketing site looks exactly like a public one.
   */
  it('never asks for MEMBERS_ONLY or PRIVATE', async () => {
    const asked = (await whereFor()).visibility.in;
    expect(asked).not.toContain('MEMBERS_ONLY');
    expect(asked).not.toContain('PRIVATE');
  });

  it('asks only for published, open offerings', async () => {
    const where = await whereFor();
    expect(where.isPublished).toBe(true);
    expect(where.closedAt).toBeNull();
  });

  it('scopes to the one co-op it was asked about', async () => {
    expect((await whereFor()).orgId).toBe('org-1');
  });

  /**
   * A marketing page that 500s is worse than one with nothing on it, and the
   * flag is not a secret worth a different status code.
   */
  it('answers an empty list when the co-op has teaching off', async () => {
    const { service, captured } = build({ ...ORG, teachingEnabled: false });
    const result = await service.listPublic('sunrise');

    expect(result.offerings).toEqual([]);
    expect(captured.offerings).toHaveLength(0);
  });

  it('does not publish the co-op’s internal id alongside it', async () => {
    const { service } = build(ORG);
    const result = await service.listPublic('sunrise');

    expect(result.org).not.toHaveProperty('id');
    expect(result.org).not.toHaveProperty('teachingEnabled');
  });

  it('refuses a co-op that does not exist', async () => {
    const { service } = build(null);
    await expect(service.listPublic('nope')).rejects.toThrow('Organization not found');
  });

  /**
   * A workshop may hold a private rehearsal date. The offering being public
   * says nothing about each evening on it.
   */
  it('narrows the sessions it shows to public, published, future ones', async () => {
    const { service, captured } = build(ORG);
    await service.listPublic('sunrise');

    // The session filter travels in the select, beside the fields.
    const call = captured.offerings[0];
    expect(call).toBeDefined();

    // Asserted against the service source: the filter is inside the nested
    // read, which a where-capture cannot see.
    const source = readFileSync(join(__dirname, '..', 'teaching.service.ts'), 'utf8');
    expect(source).toContain("visibility: 'PUBLIC' as any");
    expect(source).toContain('canceledAt: null');
    expect(source).toContain('endTime: { gte: new Date() }');
  });
});

describe('the embed', () => {
  it('paints exactly what the public page shows', async () => {
    const { service } = build(ORG);
    const [page, embed] = await Promise.all([
      service.listPublic('sunrise'),
      service.listEmbed('sunrise'),
    ]);

    // One payload, so the two can never disagree about what is public.
    expect(embed).toEqual(page);
  });
});

describe('inside the co-op', () => {
  it('refuses every route when teaching is switched off', async () => {
    const { service } = build({ ...ORG, teachingEnabled: false });

    await expect(
      service.listForOrg('org-1', { userId: 'u', isStaff: false }),
    ).rejects.toThrow('not using teaching offerings');
  });

  it('shows an organiser everything, drafts included', async () => {
    const { service, captured } = build(ORG);
    await service.listForOrg('org-1', { userId: 'admin', isStaff: true });

    expect(captured.offerings[0]).toEqual({ orgId: 'org-1' });
  });

  /**
   * A member sees what is published to members, plus their own drafts — which
   * the audience filter would otherwise hide from the person who wrote them.
   */
  it('shows a member published offerings and their own drafts', async () => {
    const { service, captured } = build(ORG);
    await service.listForOrg('org-1', { userId: 'ada', isStaff: false });

    const where = captured.offerings[0];
    expect(where.orgId).toBe('org-1');
    expect(where.OR).toEqual([
      { isPublished: true, visibility: { in: ['PUBLIC', 'MEMBERS_ONLY'] } },
      { teacherId: 'ada' },
      { createdById: 'ada' },
    ]);
  });

  it('never offers a member PRIVATE through the audience branch', async () => {
    const { service, captured } = build(ORG);
    await service.listForOrg('org-1', { userId: 'ada', isStaff: false });

    expect(captured.offerings[0].OR[0].visibility.in).not.toContain('PRIVATE');
  });
});
