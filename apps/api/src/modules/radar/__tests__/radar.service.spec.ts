import { ForbiddenException } from '@nestjs/common';
import { RadarService } from '../radar.service';

/**
 * The weekly digest, end to end against a mocked database (RDR-01).
 *
 * The behaviours worth pinning are the ones whose failure is quiet: a co-op
 * on Free being emailed anyway, a member hearing about the same gathering
 * every fifteen minutes, or a member hearing about one they already said
 * yes to. None of those throw; they just make the feature embarrassing.
 */

const NOW = new Date('2026-10-08T09:30:00Z');
const DIGEST_DAY = NOW.getUTCDay();
const DIGEST_HOUR = NOW.getUTCHours();

const ORG = {
  id: 'org-1',
  name: 'MaybeItsFate',
  slug: 'maybeitsfate',
  timezone: 'UTC',
  radarDigestDay: DIGEST_DAY,
  radarDigestHour: DIGEST_HOUR,
};

const EVENT = {
  id: 'event-1',
  slug: 'board-game-night',
  title: 'Board Game Night',
  description: 'Bring a game.',
  startTime: new Date('2026-10-15T23:00:00Z'),
  timezone: 'UTC',
  tags: ['Games'],
  priceCents: null,
  location: { name: 'The Hall' },
  room: null,
};

const MEMBER = {
  id: 'membership-1',
  userId: 'user-1',
  user: { name: 'Ada', email: 'ada@example.com' },
  interests: [
    { declared: true, rsvpCount: 0, tag: { name: 'Games', isActive: true } },
  ],
  radarSends: [] as { eventId: string }[],
};

function build(overrides: {
  orgs?: unknown[];
  events?: unknown[];
  members?: unknown[];
  rsvps?: { eventId: string }[];
}) {
  const prisma = {
    organization: {
      findMany: jest.fn().mockResolvedValue(overrides.orgs ?? [ORG]),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    event: {
      findMany: jest.fn().mockResolvedValue(overrides.events ?? [EVENT]),
      findFirst: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    userOrg: {
      findMany: jest.fn().mockResolvedValue(overrides.members ?? [MEMBER]),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    rsvp: { findMany: jest.fn().mockResolvedValue(overrides.rsvps ?? []) },
    radarSend: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    memberInterest: { findMany: jest.fn(), upsert: jest.fn(), count: jest.fn() },
    interestTag: { findMany: jest.fn(), count: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };

  const email = { sendRadarDigest: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue('https://maybeos.org') };

  const service = new RadarService(
    prisma as never,
    email as never,
    config as never,
  );

  return { service, prisma, email };
}

describe('who gets a digest', () => {
  it('sends to a member whose interests match something coming up', async () => {
    const { service, email } = build({});

    const result = await service.sendDue(NOW);

    expect(result.processed).toBe(1);
    expect(email.sendRadarDigest).toHaveBeenCalledTimes(1);

    const [to, payload] = email.sendRadarDigest.mock.calls[0];
    expect(to).toBe('ada@example.com');
    expect(payload.orgName).toBe('MaybeItsFate');
    expect(payload.events[0].title).toBe('Board Game Night');
    // The reason is printed in the email, so it has to be the real reason.
    expect(payload.events[0].matched).toEqual(['Games']);
  });

  it('only asks the database for co-ops on a plan that includes Radar', async () => {
    const { service, prisma } = build({});

    await service.sendDue(NOW);

    const where = prisma.organization.findMany.mock.calls[0][0].where;
    expect(where.radarEnabled).toBe(true);
    expect(where.plan).toEqual({ in: ['PLUS', 'UNLIMITED'] });
  });

  it('says nothing on any hour but the one the co-op chose', async () => {
    const { service, email } = build({
      orgs: [{ ...ORG, radarDigestHour: (DIGEST_HOUR + 1) % 24 }],
    });

    expect((await service.sendDue(NOW)).processed).toBe(0);
    expect(email.sendRadarDigest).not.toHaveBeenCalled();
  });

  it('says nothing on any day but the one the co-op chose', async () => {
    const { service, email } = build({ orgs: [{ ...ORG, radarDigestDay: (DIGEST_DAY + 1) % 7 }] });

    expect((await service.sendDue(NOW)).processed).toBe(0);
    expect(email.sendRadarDigest).not.toHaveBeenCalled();
  });

  it('keeps one co-op&rsquo;s failure from stopping the next co-op&rsquo;s digest', async () => {
    const { service, prisma, email } = build({ orgs: [ORG, { ...ORG, id: 'org-2', slug: 'other' }] });
    prisma.event.findMany
      .mockRejectedValueOnce(new Error('database went away'))
      .mockResolvedValueOnce([EVENT]);

    const result = await service.sendDue(NOW);

    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('maybeitsfate');
    expect(email.sendRadarDigest).toHaveBeenCalledTimes(1);
  });
});

describe('what a digest leaves out', () => {
  it('never mentions a gathering it has already mentioned', async () => {
    const { service, email } = build({
      members: [{ ...MEMBER, radarSends: [{ eventId: 'event-1' }] }],
    });

    expect((await service.sendDue(NOW)).processed).toBe(0);
    expect(email.sendRadarDigest).not.toHaveBeenCalled();
  });

  it('never mentions one the member has already RSVPed to', async () => {
    const { service, email } = build({ rsvps: [{ eventId: 'event-1' }] });

    expect((await service.sendDue(NOW)).processed).toBe(0);
    expect(email.sendRadarDigest).not.toHaveBeenCalled();
  });

  it('asks only for events open to members, published, uncancelled and ahead', async () => {
    const { service, prisma } = build({});

    await service.sendDue(NOW);

    const where = prisma.event.findMany.mock.calls[0][0].where;
    expect(where.isPublished).toBe(true);
    expect(where.canceledAt).toBeNull();
    expect(where.visibility).toEqual({ in: ['PUBLIC', 'MEMBERS_ONLY'] });
    expect(where.startTime.gte).toEqual(NOW);
  });

  it('leaves out a member who unsubscribed from the co-op&rsquo;s email entirely', async () => {
    const { service, prisma } = build({});

    await service.sendDue(NOW);

    const where = prisma.userOrg.findMany.mock.calls[0][0].where;
    expect(where.radarEmails).toBe(true);
    expect(where.emailOptIn).toEqual({ not: false });
    expect(where.role).toEqual({ in: ['ADMIN', 'STAFF', 'MEMBER'] });
  });

  it('ignores an interest the co-op has retired', async () => {
    const { service, email } = build({
      members: [
        {
          ...MEMBER,
          interests: [{ declared: true, rsvpCount: 0, tag: { name: 'Games', isActive: false } }],
        },
      ],
    });

    expect((await service.sendDue(NOW)).processed).toBe(0);
    expect(email.sendRadarDigest).not.toHaveBeenCalled();
  });
});

describe('not sending twice', () => {
  it('records the send before handing the email over, because a failure is swallowed', async () => {
    const { service, prisma, email } = build({});
    const order: string[] = [];
    prisma.$transaction.mockImplementation(async () => {
      order.push('recorded');
      return [];
    });
    email.sendRadarDigest.mockImplementation(async () => {
      order.push('sent');
    });

    await service.sendDue(NOW);

    expect(order).toEqual(['recorded', 'sent']);
  });

  it('writes one radar_send row per gathering mentioned', async () => {
    const { service, prisma } = build({});

    await service.sendDue(NOW);

    expect(prisma.radarSend.createMany).toHaveBeenCalledWith({
      data: [{ userOrgId: 'membership-1', eventId: 'event-1' }],
      skipDuplicates: true,
    });
  });
});

describe('the links in the email', () => {
  it('sends the member to the event rather than to an endpoint that books a seat', async () => {
    const { service, email } = build({});

    await service.sendDue(NOW);
    const payload = email.sendRadarDigest.mock.calls[0][1];

    expect(payload.events[0].rsvpUrl).toBe(
      'https://maybeos.org/portal/maybeitsfate/events/board-game-night?rsvp=radar',
    );
  });

  it('says why it arrived, and only claims the member said so when they did', async () => {
    const { service, email } = build({
      members: [
        {
          ...MEMBER,
          interests: [
            // Inferred, not declared: three RSVPs to games nights, nothing said.
            { declared: null, rsvpCount: 3, tag: { name: 'Games', isActive: true } },
          ],
        },
      ],
    });

    await service.sendDue(NOW);
    const payload = email.sendRadarDigest.mock.calls[0][1];

    expect(payload.events[0].matched).toEqual(['Games']);
    // Empty, so the email says "you've been to Games gatherings before"
    // rather than telling the member they said something they never said.
    expect(payload.events[0].declaredMatches).toEqual([]);
  });

  it('sends a ticketed gathering to the page without asking it to RSVP', async () => {
    const { service, email } = build({ events: [{ ...EVENT, priceCents: 1500 }] });

    await service.sendDue(NOW);
    const payload = email.sendRadarDigest.mock.calls[0][1];

    expect(payload.events[0].ticketed).toBe(true);
    // No `?rsvp=radar`: the page offers Buy for a ticketed event and refuses
    // to book a free seat, so the parameter would promise what it won't do.
    expect(payload.events[0].rsvpUrl).toBe(
      'https://maybeos.org/portal/maybeitsfate/events/board-game-night',
    );
  });

  it('carries an unsubscribe link and a way to change the interests', async () => {
    const { service, email } = build({});

    await service.sendDue(NOW);
    const payload = email.sendRadarDigest.mock.calls[0][1];

    expect(payload.unsubscribeUrl).toContain('/radar/unsubscribe?token=');
    // `/member/...`, which is where the profile page actually lives — the
    // first version of this pointed at `/portal/...`, a route that has no
    // profile page on it, and the link would have 404'd in sent email.
    expect(payload.interestsUrl).toBe(
      'https://maybeos.org/member/maybeitsfate/profile#interests',
    );
  });
});

describe('the switch', () => {
  it('refuses to turn Radar on for a co-op on Free', async () => {
    const { service, prisma } = build({});
    prisma.organization.findUnique.mockResolvedValue({ plan: 'FREE' });

    await expect(service.updateSettings('org-1', { enabled: true })).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it('lets a co-op that has dropped to Free turn it off', async () => {
    const { service, prisma } = build({});
    prisma.organization.findUnique
      .mockResolvedValueOnce({ plan: 'FREE' })
      .mockResolvedValue({ plan: 'FREE', radarEnabled: false, radarDigestDay: 4, radarDigestHour: 9 });
    prisma.interestTag.count.mockResolvedValue(1);
    prisma.interestTag.findMany.mockResolvedValue([]);

    await expect(service.updateSettings('org-1', { enabled: false })).resolves.toBeDefined();
    expect(prisma.organization.update).toHaveBeenCalled();
  });
});

describe('learning from an RSVP', () => {
  it('counts the event&rsquo;s interests toward the member', async () => {
    const { service, prisma } = build({});
    prisma.event.findFirst.mockResolvedValue({ tags: ['Games', 'Social'] });
    prisma.userOrg.findFirst.mockResolvedValue({ id: 'membership-1' });
    prisma.interestTag.findMany.mockResolvedValue([{ id: 'tag-games' }, { id: 'tag-social' }]);

    await service.recordRsvp('org-1', 'event-1', 'user-1');

    expect(prisma.memberInterest.upsert).toHaveBeenCalledTimes(2);
    const first = prisma.memberInterest.upsert.mock.calls[0][0];
    expect(first.create.rsvpCount).toBe(1);
    expect(first.update.rsvpCount).toEqual({ increment: 1 });
  });

  it('learns nothing from a tag that is not on the co-op&rsquo;s list', async () => {
    const { service, prisma } = build({});
    prisma.event.findFirst.mockResolvedValue({ tags: ['Something a host typed in 2024'] });
    prisma.userOrg.findFirst.mockResolvedValue({ id: 'membership-1' });
    prisma.interestTag.findMany.mockResolvedValue([]);

    await service.recordRsvp('org-1', 'event-1', 'user-1');

    expect(prisma.memberInterest.upsert).not.toHaveBeenCalled();
  });

  it('never lets its own failure reach the member getting a seat', async () => {
    const { service, prisma } = build({});
    prisma.event.findFirst.mockRejectedValue(new Error('database went away'));

    await expect(service.recordRsvp('org-1', 'event-1', 'user-1')).resolves.toBeUndefined();
  });
});
