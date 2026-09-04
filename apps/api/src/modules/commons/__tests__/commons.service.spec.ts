import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Tenant isolation for CommonsOS (CMN-07).
 *
 * Every route on this controller sits under `orgs/:orgId`, and until
 * 2026-08-12 twenty service methods took an entity id and never compared it
 * to that org. `OrgMembershipGuard` proves the caller belongs to the org in
 * the URL — which the caller writes — so pairing your own org id with another
 * co-op's post, comment, proposal, collection or page id was enough to read
 * it, edit it, delete it, or vote in its governance.
 *
 * The table below is the point of this file: it asserts that *every* one of
 * those methods refuses, rather than spot-checking a couple and trusting the
 * rest. A new method added without scoping should show up here as an
 * omission, not as a silent hole.
 */
describe('CommonsService — tenant isolation (CMN-07)', () => {
  let service: CommonsService;
  let prisma: jest.Mocked<PrismaService>;

  const OTHER = 'org-not-yours';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        {
          provide: PrismaService,
          useValue: {
            channel: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
            post: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
            comment: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
            reaction: { upsert: jest.fn(), deleteMany: jest.fn() },
            proposal: { findFirst: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
            vote: { upsert: jest.fn() },
            collection: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
            collectionPage: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
            directMessage: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
            userOrg: { findFirst: jest.fn(), findMany: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CommonsService>(CommonsService);
    prisma = module.get(PrismaService);

    // Every scoped lookup misses, which is what Prisma returns once the org
    // filter is applied to somebody else's id.
    prisma.channel.findFirst.mockResolvedValue(null);
    prisma.post.findFirst.mockResolvedValue(null);
    prisma.comment.findFirst.mockResolvedValue(null);
    prisma.proposal.findFirst.mockResolvedValue(null);
    prisma.collection.findFirst.mockResolvedValue(null);
    prisma.collectionPage.findFirst.mockResolvedValue(null);
    prisma.userOrg.findFirst.mockResolvedValue(null);
  });

  // Each entry: a method reached with an id belonging to another org.
  const crossOrgCalls: Array<[string, () => Promise<unknown>]> = [
    ['pinChannel', () => service.pinChannel(OTHER, 'channel-1', true)],
    ['createPost', () => service.createPost(OTHER, 'channel-1', 'u1', { body: 'x' } as never)],
    ['listPosts', () => service.listPosts(OTHER, 'channel-1', 1, 20)],
    ['getPost', () => service.getPost(OTHER, 'post-1')],
    ['addComment', () => service.addComment(OTHER, 'post-1', 'u1', 'hello')],
    ['flagComment', () => service.flagComment(OTHER, 'comment-1')],
    ['editComment', () => service.editComment(OTHER, 'comment-1', 'u1', 'rewritten')],
    ['addReaction', () => service.addReaction(OTHER, 'post-1', 'u1', '👍')],
    ['removeReaction', () => service.removeReaction(OTHER, 'post-1', 'u1', '👍')],
    ['flagPost', () => service.flagPost(OTHER, 'post-1')],
    ['createProposal', () => service.createProposal(OTHER, 'channel-1', 'u1', { title: 't', body: 'b' } as never)],
    ['openProposal', () => service.openProposal(OTHER, 'proposal-1')],
    ['closeProposal', () => service.closeProposal(OTHER, 'proposal-1')],
    ['castVote', () => service.castVote(OTHER, 'proposal-1', 'u1', 'YES' as never)],
    ['getProposal', () => service.getProposal(OTHER, 'proposal-1')],
    ['updateCollection', () => service.updateCollection(OTHER, 'collection-1', {} as never)],
    ['deleteCollection', () => service.deleteCollection(OTHER, 'collection-1')],
    ['createPage', () => service.createPage(OTHER, 'collection-1', 'u1', { title: 't', body: 'b' } as never)],
    ['getPage', () => service.getPage(OTHER, 'page-1')],
    ['updatePage', () => service.updatePage(OTHER, 'page-1', {} as never)],
    ['deletePage', () => service.deletePage(OTHER, 'page-1')],
    ['getConversation', () => service.getConversation(OTHER, 'u1', 'u2')],
    ['sendMessage', () => service.sendMessage(OTHER, 'u1', 'u2', 'hi')],
    ['markConversationRead', () => service.markConversationRead(OTHER, 'u1', 'u2')],
  ];

  it.each(crossOrgCalls)('%s refuses an id from another org', async (_name, call) => {
    await expect(call()).rejects.toThrow(NotFoundException);
  });

  it('writes nothing when a cross-org call is refused', async () => {
    await Promise.allSettled(crossOrgCalls.map(([, call]) => call()));

    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(prisma.post.update).not.toHaveBeenCalled();
    expect(prisma.comment.create).not.toHaveBeenCalled();
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
    expect(prisma.reaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.proposal.create).not.toHaveBeenCalled();
    expect(prisma.proposal.update).not.toHaveBeenCalled();
    expect(prisma.vote.upsert).not.toHaveBeenCalled();
    expect(prisma.collection.update).not.toHaveBeenCalled();
    expect(prisma.collection.delete).not.toHaveBeenCalled();
    expect(prisma.collectionPage.create).not.toHaveBeenCalled();
    expect(prisma.collectionPage.update).not.toHaveBeenCalled();
    expect(prisma.collectionPage.delete).not.toHaveBeenCalled();
    expect(prisma.directMessage.create).not.toHaveBeenCalled();
    expect(prisma.directMessage.updateMany).not.toHaveBeenCalled();
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

  it('reads direct messages only within the org (CMN-08)', async () => {
    const OWN = 'org-mine';
    prisma.userOrg.findFirst.mockResolvedValue({ id: 'membership-1' } as never);
    prisma.directMessage.findMany.mockResolvedValue([]);

    await service.listConversations(OWN, 'u1');
    await service.getConversation(OWN, 'u1', 'u2');
    await service.markConversationRead(OWN, 'u1', 'u2');

    // Every read and write names the org. Before CMN-08 a conversation had a
    // sender and a receiver and nothing else, so the org in the URL could not
    // restrict what came back — it could only be checked against the people.
    for (const call of prisma.directMessage.findMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ orgId: OWN }));
    }
    expect(prisma.directMessage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orgId: OWN }) }),
    );
  });

  it('stamps a new message with the org it was sent in (CMN-08)', async () => {
    const OWN = 'org-mine';
    prisma.userOrg.findFirst.mockResolvedValue({ id: 'membership-1' } as never);
    prisma.directMessage.create.mockResolvedValue({ id: 'dm-1' } as never);

    await service.sendMessage(OWN, 'u1', 'u2', 'hello');

    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ orgId: OWN, senderId: 'u1', receiverId: 'u2' }),
      }),
    );
  });

  it('resolves entities through their org, not by id alone', async () => {
    const OWN = 'org-mine';
    await service.getPost(OWN, 'post-1').catch(() => undefined);
    await service.getProposal(OWN, 'proposal-1').catch(() => undefined);
    await service.getPage(OWN, 'page-1').catch(() => undefined);
    await service.flagComment(OWN, 'comment-1').catch(() => undefined);

    // The ownership chains, which are the part most likely to be got wrong.
    expect(prisma.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'post-1', channel: { orgId: OWN } } }),
    );
    expect(prisma.proposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'proposal-1', channel: { orgId: OWN } } }),
    );
    expect(prisma.collectionPage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'page-1', collection: { orgId: OWN } } }),
    );
    expect(prisma.comment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comment-1', post: { channel: { orgId: OWN } } } }),
    );
  });
});

describe('CommonsService — voting is only open while a proposal is open', () => {
  let service: CommonsService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-mine';
  const openProposal = {
    id: 'p1',
    status: 'OPEN',
    closesAt: null as Date | null,
    channelId: 'c1',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        {
          provide: PrismaService,
          useValue: {
            proposal: { findFirst: jest.fn() },
            vote: { upsert: jest.fn().mockResolvedValue({}) },
          },
        },
      ],
    }).compile();

    service = module.get<CommonsService>(CommonsService);
    prisma = module.get(PrismaService);
  });

  it('accepts a vote on an open proposal with no deadline', async () => {
    prisma.proposal.findFirst.mockResolvedValue(openProposal as never);

    await service.castVote(ORG, 'p1', 'u1', 'YES' as never);

    expect(prisma.vote.upsert).toHaveBeenCalled();
  });

  it('accepts a vote before the deadline', async () => {
    prisma.proposal.findFirst.mockResolvedValue({
      ...openProposal,
      closesAt: new Date(Date.now() + 60_000),
    } as never);

    await service.castVote(ORG, 'p1', 'u1', 'YES' as never);

    expect(prisma.vote.upsert).toHaveBeenCalled();
  });

  it.each(['DRAFT', 'CLOSED', 'PASSED', 'FAILED'])(
    'refuses a vote on a %s proposal',
    async (status) => {
      prisma.proposal.findFirst.mockResolvedValue({ ...openProposal, status } as never);

      await expect(service.castVote(ORG, 'p1', 'u1', 'YES' as never)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.vote.upsert).not.toHaveBeenCalled();
    },
  );

  it('refuses a vote after the deadline, even before the scheduler has closed it', async () => {
    // The row still says OPEN because the fifteen-minute job has not run yet.
    // The deadline is the deadline.
    prisma.proposal.findFirst.mockResolvedValue({
      ...openProposal,
      closesAt: new Date(Date.now() - 1000),
    } as never);

    await expect(service.castVote(ORG, 'p1', 'u1', 'YES' as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.vote.upsert).not.toHaveBeenCalled();
  });
});
