import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ATTACHMENT_BUCKET,
  COVER_MAX_BYTES,
  LOGO_BUCKET,
  StorageService,
} from '../../storage/storage.service';

/**
 * Article covers are private (BEL-10).
 *
 * This started as a public URL, on the reasoning that cover art is org-level
 * content rather than member PII. The reference screenshots settled it the
 * other way: a cover is typically a photograph of that co-op's members in
 * their own space, and a Knowledge Center article is members-only — so a
 * permanent public link would be a photo of a co-op's members reachable by
 * anyone who ever got the URL.
 *
 * The tests below are the ones that would fail if somebody reversed that
 * again, which is easy to do because "it's just a picture on an article" is a
 * perfectly reasonable thing to think.
 */
describe('article covers', () => {
  const build = (fetchImpl?: jest.Mock) => {
    const service = new StorageService({
      get: (key: string) =>
        key === 'SUPABASE_URL' ? 'https://project.supabase.co' : 'service-role-key',
    } as unknown as ConfigService);
    if (fetchImpl) global.fetch = fetchImpl as unknown as typeof fetch;
    return service;
  };

  /** A real 1x1 PNG, because the uploader sniffs magic bytes. */
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
      '05fe02fea7c4ba0000000049454e44ae426082',
    'hex',
  );

  it('stores a cover in the private bucket, never the public one', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
    const service = build(fetchMock);

    const path = await service.uploadArticleCover('org1', png, 'image/png');

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(ATTACHMENT_BUCKET);
    expect(url).not.toContain(LOGO_BUCKET);
    // And what comes back is a path to sign later, not a link anybody can use.
    expect(path).toMatch(/^org1\/article-covers\/[0-9a-f-]+\.png$/);
    expect(path).not.toContain('http');
    expect(path).not.toContain('/public/');
  });

  it('scopes the key to the co-op that owns it', async () => {
    const service = build(jest.fn().mockResolvedValue({ ok: true, text: async () => '' }));
    const path = await service.uploadArticleCover('org-abc', png, 'image/png');
    expect(path.startsWith('org-abc/')).toBe(true);
  });

  it('believes the bytes, not the content type', async () => {
    // A text file renamed to .png must not become a stored image on the
    // strength of a header the browser was told to send.
    const service = build(jest.fn());
    const notAnImage = Buffer.from('#!/bin/sh\nrm -rf /\n'.padEnd(64, ' '));

    await expect(service.uploadArticleCover('org1', notAnImage, 'image/png')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a file too big to be a cover, in a sentence', async () => {
    const service = build(jest.fn());
    const huge = Buffer.concat([png, Buffer.alloc(COVER_MAX_BYTES)]);

    await expect(service.uploadArticleCover('org1', huge, 'image/png')).rejects.toThrow(/under \d+ MB/);
  });

  it('writes a fresh key every time, so a failed replacement keeps the old cover', async () => {
    const service = build(jest.fn().mockResolvedValue({ ok: true, text: async () => '' }));

    const first = await service.uploadArticleCover('org1', png, 'image/png');
    const second = await service.uploadArticleCover('org1', png, 'image/png');

    expect(first).not.toBe(second);
  });

  describe('signing', () => {
    it('signs a whole index in one request, not one per article', async () => {
      // A dozen articles would otherwise be a dozen round trips to Storage to
      // render one screen.
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          { path: 'a.png', signedURL: '/object/sign/attachments/a.png?token=x' },
          { path: 'b.png', signedURL: '/object/sign/attachments/b.png?token=y' },
        ],
      });
      const service = build(fetchMock);

      const signed = await service.signedAttachmentUrls(['a.png', 'b.png']);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(signed.get('a.png')).toContain('token=x');
      expect(signed.get('b.png')).toContain('token=y');
    });

    it('keeps the rest when one file has gone missing', async () => {
      const service = build(
        jest.fn().mockResolvedValue({
          ok: true,
          json: async () => [
            { path: 'gone.png', error: 'not found' },
            { path: 'here.png', signedURL: '/object/sign/attachments/here.png?token=z' },
          ],
        }),
      );

      const signed = await service.signedAttachmentUrls(['gone.png', 'here.png']);
      expect(signed.has('gone.png')).toBe(false);
      expect(signed.get('here.png')).toContain('token=z');
    });

    it('returns nothing rather than throwing when Storage is unhappy', async () => {
      // A cover that will not sign should cost an article its picture, not
      // its whole page.
      const service = build(jest.fn().mockResolvedValue({ ok: false, text: async () => 'nope' }));
      await expect(service.signedAttachmentUrls(['a.png'])).resolves.toEqual(new Map());
    });
  });
});
