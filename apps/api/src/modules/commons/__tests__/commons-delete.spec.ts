import { Test } from '@nestjs/testing';
import { CommonsService } from '../commons.service';
import { ThreadsService } from '../threads.service';
import { PrismaService } from '../../../config/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../platform/audit.service';

/**
 * Taking something down (CMN-18).
 *
 * Before this there was no way to remove anything from the Commons. Flagging
 * was the only moderation it had ever had, and `isFlagged` is written by two
 * methods and read by nothing at all — a flagged post stayed exactly where it
 * was, fully visible, with nothing anywhere to show for it. An admin's choice
 * was to delete a whole channel or to leave it.
 *
 * The failures worth pinning are the quiet ones: a file left in the bucket
 * after the row that referenced it is gone, and a reply two levels down whose
 * attachment nobody swept.
 */
describe('CommonsService — taking a post or comment down', () => {
  let service: CommonsService;
  let prisma: any;
  let storage: any;
  let audit: any;

  const POST = { id: 'post-1', authorId: 'author-1', title: 'A post', channelId: 'ch-1' };
  const COMMENT = { id: 'c1', authorId: 'author-2', postId: 'post-1' };

  beforeEach(async () => {
    prisma = {
      post: { findFirst: jest.fn().mockResolvedValue(POST), delete: jest.fn() },
      comment: {
        findFirst: jest.fn().mockResolvedValue(COMMENT),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
    };
    storage = { deleteAttachment: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: {} },
        { provide: StorageService, useValue: storage },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(CommonsService);
  });

  describe('a post', () => {
    it('resolves it through the co-op, never by bare id', async () => {
      // CMN-07, SEC-04: `OrgMembershipGuard` proves only that the caller
      // belongs to the org in the URL, and the caller writes the URL.
      await service.deletePost('org-1', 'post-1', 'admin-1');

      expect(prisma.post.findFirst).toHaveBeenCalledWith({
        where: { id: 'post-1', channel: { orgId: 'org-1' } },
      });
    });

    it('takes the files out of the bucket, not just the rows', async () => {
      /*
        The attachment rows cascade in the database and the objects do not.
        A moderation delete that leaves the bytes behind has not removed the
        thing somebody complained about — anybody holding a link still has it.
      */
      prisma.attachment.findMany.mockResolvedValue([
        { path: 'org-1/a.png' },
        { path: 'org-1/b.pdf' },
      ]);

      await service.deletePost('org-1', 'post-1', 'admin-1');

      expect(storage.deleteAttachment).toHaveBeenCalledWith('org-1', 'org-1/a.png');
      expect(storage.deleteAttachment).toHaveBeenCalledWith('org-1', 'org-1/b.pdf');
    });

    it('sweeps the comments’ files as well as the post’s own', async () => {
      await service.deletePost('org-1', 'post-1', 'admin-1');

      // The comments cascade, which takes their attachment rows with them and
      // silently leaves their objects.
      expect(prisma.attachment.findMany.mock.calls[0][0].where).toEqual({
        OR: [{ postId: 'post-1' }, { comment: { postId: 'post-1' } }],
      });
    });

    it('gathers the files before the rows are gone', async () => {
      const order: string[] = [];
      prisma.attachment.findMany.mockImplementation(async () => {
        order.push('gather');
        return [];
      });
      prisma.post.delete.mockImplementation(async () => {
        order.push('delete');
      });

      await service.deletePost('org-1', 'post-1', 'admin-1');

      // Afterwards there is nothing left to ask.
      expect(order).toEqual(['gather', 'delete']);
    });

    it('does not let one stuck file strand the rest', async () => {
      prisma.attachment.findMany.mockResolvedValue([
        { path: 'org-1/a.png' },
        { path: 'org-1/b.pdf' },
      ]);
      storage.deleteAttachment.mockRejectedValueOnce(new Error('bucket unavailable'));

      await expect(service.deletePost('org-1', 'post-1', 'admin-1')).resolves.toEqual({
        deleted: true,
      });
      expect(storage.deleteAttachment).toHaveBeenCalledTimes(2);
    });

    it('writes it down, without copying the post back out', async () => {
      await service.deletePost('org-1', 'post-1', 'admin-1');

      const entry = audit.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        orgId: 'org-1',
        actorId: 'admin-1',
        action: 'commons.post_deleted',
        entityId: 'post-1',
      });
      // Enough to answer "what was taken down and whose was it".
      expect(entry.metadata).toMatchObject({ authorId: 'author-1', title: 'A post' });
      expect(JSON.stringify(entry.metadata)).not.toContain('body');
    });
  });

  describe('a comment', () => {
    it('sweeps the files of replies at any depth', async () => {
      /*
        A reply can itself be replied to, so the cascade on `Comment.parent`
        goes all the way down. Sweeping only the direct replies would delete a
        grandchild's row and leave its object in the bucket — on a moderation
        delete, still downloadable.
      */
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c1', parentId: null },
        { id: 'c2', parentId: 'c1' },
        { id: 'c3', parentId: 'c2' },
        { id: 'elsewhere', parentId: null },
      ]);

      await service.deleteComment('org-1', 'c1', 'admin-1');

      const where = prisma.attachment.findMany.mock.calls[0][0].where;
      expect([...where.commentId.in].sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('finds a reply listed before its parent', async () => {
      // The rows come back in no particular order, so a single pass would miss
      // a descendant that happens to be listed first.
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c3', parentId: 'c2' },
        { id: 'c2', parentId: 'c1' },
        { id: 'c1', parentId: null },
      ]);

      await service.deleteComment('org-1', 'c1', 'admin-1');

      const where = prisma.attachment.findMany.mock.calls[0][0].where;
      expect([...where.commentId.in].sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('leaves another branch of the thread alone', async () => {
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c1', parentId: null },
        { id: 'other', parentId: null },
        { id: 'other-reply', parentId: 'other' },
      ]);

      await service.deleteComment('org-1', 'c1', 'admin-1');

      const where = prisma.attachment.findMany.mock.calls[0][0].where;
      expect(where.commentId.in).toEqual(['c1']);
    });

    it('resolves it through the co-op, never by bare id', async () => {
      await service.deleteComment('org-1', 'c1', 'admin-1');

      expect(prisma.comment.findFirst).toHaveBeenCalledWith({
        where: { id: 'c1', post: { channel: { orgId: 'org-1' } } },
      });
    });

    it('says how many replies went with it', async () => {
      prisma.comment.findMany.mockResolvedValue([
        { id: 'c1', parentId: null },
        { id: 'c2', parentId: 'c1' },
        { id: 'c3', parentId: 'c2' },
      ]);

      await service.deleteComment('org-1', 'c1', 'admin-1');

      // Deleting one comment can remove a conversation.
      expect(audit.record.mock.calls[0][0].metadata.replies).toBe(2);
    });
  });
});
