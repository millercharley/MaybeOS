import { Test, TestingModule } from '@nestjs/testing';
import { CommonsService } from '../commons.service';
import { PrismaService } from '../../../config/prisma.service';
import { ThreadsService } from '../threads.service';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../../platform/audit.service';

/**
 * A channel's files come with its posts (CMN-28).
 *
 * Each post's attachments were fetched by the component that rendered them,
 * one request per post. A channel showing eleven posts made eleven
 * simultaneous calls to `/attachments` — measured on production at
 * 15:16:17.325, every one inside the same millisecond.
 *
 * The durations were bimodal and nothing in between: about half a second
 * against a warm Lambda, six and a half against a cold one. Eleven at once
 * with nothing warm is eleven cold starts and eleven of Supavisor's two
 * hundred client connections, spent on a screen the reader is still waiting
 * for.
 *
 * `signedAttachmentUrls` already existed for exactly this — its own comment
 * says "one request rather than one per row" — and nothing in the Commons
 * used it.
 */
describe('CommonsService — attachments on the feed', () => {
  const file = (id: string, path: string) => ({
    id,
    fileName: `${id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    path,
    createdAt: new Date('2026-10-30T12:00:00Z'),
  });

  const build = async (over: { posts?: unknown[]; signed?: Map<string, string> } = {}) => {
    const posts = over.posts ?? [
      { id: 'p1', channelId: 'ch-1', reactions: [], attachments: [file('a1', 'org/a1.pdf')] },
      { id: 'p2', channelId: 'ch-1', reactions: [], attachments: [file('a2', 'org/a2.pdf')] },
      { id: 'p3', channelId: 'ch-1', reactions: [], attachments: [] },
    ];

    const signedAttachmentUrls = jest
      .fn()
      .mockResolvedValue(
        over.signed ??
          new Map([
            ['org/a1.pdf', 'https://files/a1?sig=1'],
            ['org/a2.pdf', 'https://files/a2?sig=2'],
          ]),
      );

    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue({ id: 'ch-1', orgId: 'org-1' }) },
      post: { findMany: jest.fn().mockResolvedValue(posts), count: jest.fn().mockResolvedValue(3) },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommonsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ThreadsService, useValue: {} },
        { provide: StorageService, useValue: { signedAttachmentUrls } },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();

    return { service: module.get(CommonsService), prisma, signedAttachmentUrls };
  };

  it('sends each post its own files', async () => {
    const { service } = await build();

    const { data } = await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(data[0].attachments).toEqual([
      expect.objectContaining({ id: 'a1', url: 'https://files/a1?sig=1' }),
    ]);
    expect(data[1].attachments).toEqual([
      expect.objectContaining({ id: 'a2', url: 'https://files/a2?sig=2' }),
    ]);
  });

  /** The whole point: one signing request for the page, not one per post. */
  it('signs every file on the page in a single request', async () => {
    const { service, signedAttachmentUrls } = await build();

    await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(signedAttachmentUrls).toHaveBeenCalledTimes(1);
    expect(signedAttachmentUrls).toHaveBeenCalledWith(
      ['org/a1.pdf', 'org/a2.pdf'],
      // Five minutes. A signed URL is a bearer token by construction, so the
      // mitigation for member material is that it dies quickly.
      300,
    );
  });

  /**
   * An empty array is an answer — "this post has none" — and the component
   * reads it as one. Sending nothing would send it back to asking.
   */
  it('gives a post with no files an empty list rather than nothing', async () => {
    const { service } = await build();

    const { data } = await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(data[2].attachments).toEqual([]);
  });

  /** The storage key is not the reader's business. */
  it('never sends the storage path', async () => {
    const { service } = await build();

    const { data } = await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(JSON.stringify(data)).not.toContain('org/a1.pdf');
    expect(data[0].attachments[0]).not.toHaveProperty('path');
  });

  /**
   * One deleted object should cost its own row, not the post it hangs from.
   * `signedAttachmentUrls` reports per path for this reason.
   */
  it('leaves out a file that could not be signed, and keeps the post', async () => {
    const { service } = await build({
      signed: new Map([['org/a2.pdf', 'https://files/a2?sig=2']]),
    });

    const { data } = await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(data[0].attachments).toEqual([]);
    expect(data[0].id).toBe('p1');
    expect(data[1].attachments).toHaveLength(1);
  });

  /** Nothing to sign, nothing to ask for. */
  it('still answers when no post on the page has a file', async () => {
    const { service } = await build({
      posts: [{ id: 'p1', channelId: 'ch-1', reactions: [], attachments: [] }],
    });

    const { data } = await service.listPosts('org-1', 'ch-1', 1, 20);

    expect(data[0].attachments).toEqual([]);
  });
});
