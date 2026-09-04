import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';

/**
 * Who may rewrite a comment (CMN-09).
 *
 * Charley: the author of any comment can edit their comment. The word doing
 * the work is *their* — editing is authorship, not rank, so this is the one
 * write in CommonsOS that an ADMIN does not get for free. An organiser
 * silently rewriting a member's words in a co-op's own discussion is a
 * different feature, and not one anybody asked for.
 *
 * The cross-org half of this is covered by the table in commons.service.spec:
 * the org check runs first, so a comment id from another co-op is "not found"
 * before authorship is ever considered.
 */
describe('CommonsService — editing a comment', () => {
  let service: CommonsService;
  let prisma: jest.Mocked<PrismaService>;

  const ORG = 'org-1';
  const AUTHOR = 'user-who-wrote-it';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        {
          provide: PrismaService,
          useValue: {
            comment: { findFirst: jest.fn(), update: jest.fn() },
          },
        },
      ],
    }).compile();

    service = module.get<CommonsService>(CommonsService);
    prisma = module.get(PrismaService);

    prisma.comment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: AUTHOR,
      body: 'what they said',
    } as never);
    prisma.comment.update.mockResolvedValue({ id: 'comment-1' } as never);
  });

  it('lets the author rewrite what they wrote', async () => {
    await service.editComment(ORG, 'comment-1', AUTHOR, 'what they meant');

    expect(prisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'comment-1' },
        data: expect.objectContaining({ body: 'what they meant' }),
      }),
    );
  });

  it('stamps editedAt, so the thread can say so honestly', async () => {
    await service.editComment(ORG, 'comment-1', AUTHOR, 'revised');

    const { data } = prisma.comment.update.mock.calls[0][0] as { data: { editedAt: Date } };
    expect(data.editedAt).toBeInstanceOf(Date);
  });

  it('refuses somebody else, and writes nothing', async () => {
    await expect(
      service.editComment(ORG, 'comment-1', 'a-different-member', 'not yours'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.comment.update).not.toHaveBeenCalled();
  });

  it('refuses an organiser too — this is authorship, not rank', async () => {
    // Nothing in the service consults a role, and that is deliberate. If a
    // future change grants organisers the edit, this test is where it argues
    // its case.
    await expect(
      service.editComment(ORG, 'comment-1', 'the-admin', 'tidied up'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a comment that is not in this co-op', async () => {
    prisma.comment.findFirst.mockResolvedValue(null);

    await expect(
      service.editComment(ORG, 'comment-elsewhere', AUTHOR, 'x'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.comment.update).not.toHaveBeenCalled();
  });
});
