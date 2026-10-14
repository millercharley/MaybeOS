import { NotFoundException } from '@nestjs/common';
import { KnowledgeService } from '../knowledge.service';
import { bodyImagePaths, signBodyImages } from '../body-images';

/**
 * Pictures inside a handbook article's own text (BEL-13).
 *
 * Charley: "I need to add an image in-line in this Handbook post."
 *
 * The attachments bucket is private, because the handbook is for members —
 * so the only thing that works in an `<img src>` is a signed URL, and those
 * expire. Saving one would give an article that looked right for an hour and
 * was broken by morning. The body keeps the path; the reader is handed a
 * fresh link each time.
 */
const img = (path: string, extra = '') =>
  `<img src="https://signed.example/old?token=stale" data-path="${path}"${extra} />`;

describe('finding the pictures in a body', () => {
  it('reads the stored path, not the link', () => {
    expect(bodyImagePaths(`<p>a</p>${img('org/article-body/a.jpg')}`)).toEqual([
      'org/article-body/a.jpg',
    ]);
  });

  it('asks for each one once, however often it appears', () => {
    // An article is read far more often than it is written, and the same
    // diagram twice is still one signature.
    const body = `${img('org/x.jpg')}<p>mid</p>${img('org/x.jpg')}`;
    expect(bodyImagePaths(body)).toEqual(['org/x.jpg']);
  });

  it('ignores a picture that is not ours', () => {
    // Somebody may have pasted one from elsewhere. That is theirs.
    expect(bodyImagePaths('<img src="https://elsewhere.example/a.png" />')).toEqual([]);
  });

  it('answers nothing for nothing', () => {
    expect(bodyImagePaths('')).toEqual([]);
    expect(bodyImagePaths(null)).toEqual([]);
    expect(bodyImagePaths('<p>no pictures here</p>')).toEqual([]);
  });
});

describe('handing the reader links that work', () => {
  const urls = new Map([['org/article-body/a.jpg', 'https://signed.example/new?token=fresh']]);

  it('replaces a stale link with a fresh one', () => {
    const out = signBodyImages(img('org/article-body/a.jpg'), urls);

    expect(out).toContain('token=fresh');
    expect(out).not.toContain('token=stale');
  });

  it('keeps the path, so the next read can sign it again', () => {
    // Dropping it would orphan the picture the first time an admin saves.
    expect(signBodyImages(img('org/article-body/a.jpg'), urls)).toContain(
      'data-path="org/article-body/a.jpg"',
    );
  });

  it('keeps the words around it exactly', () => {
    const body = `<p>Tap the white circle.</p>${img('org/article-body/a.jpg')}<p>Then enter it.</p>`;
    const out = signBodyImages(body, urls);

    expect(out).toContain('<p>Tap the white circle.</p>');
    expect(out).toContain('<p>Then enter it.</p>');
  });

  it('keeps the description somebody wrote', () => {
    const out = signBodyImages(img('org/article-body/a.jpg', ' alt="The side door"'), urls);
    expect(out).toContain('alt="The side door"');
  });

  it('drops a picture it cannot sign rather than leaving it broken', () => {
    /*
      A broken-image icon in the middle of the house rules looks like the
      co-op is broken. An absent picture looks like an absent picture.
    */
    const out = signBodyImages(`<p>a</p>${img('org/missing.jpg')}<p>b</p>`, urls);

    expect(out).not.toContain('<img');
    expect(out).toContain('<p>a</p>');
    expect(out).toContain('<p>b</p>');
  });

  it('leaves a picture from elsewhere alone', () => {
    const outside = '<img src="https://elsewhere.example/a.png" alt="theirs" />';
    expect(signBodyImages(outside, urls)).toBe(outside);
  });

  it('escapes what it writes back', () => {
    // The path and the description go into attributes we are building.
    const out = signBodyImages(img('org/a.jpg', ' alt="a &quot; quote"'), new Map([['org/a.jpg', 'https://x/y?a=1&b=2']]));

    expect(out).toContain('a=1&amp;b=2');
    expect(out).not.toMatch(/alt="a " quote"/);
  });

  it('answers nothing for nothing', () => {
    expect(signBodyImages('', urls)).toBe('');
    expect(signBodyImages(null, urls)).toBe('');
  });
});

/**
 * And that the service actually uses them (BEL-13).
 *
 * The two functions above were fully tested and nothing asserted that
 * anything called them — taking the re-signing out of `get` broke every
 * picture in the handbook and the suite stayed green. A pure helper nobody
 * invokes is a pure helper that does nothing.
 */
describe('reading an article', () => {
  const ARTICLE = {
    id: 'a1',
    title: 'Building access',
    coverImagePath: 'org1/article-covers/cover.jpg',
    body: '<p>Tap the circle.</p><img src="https://old?token=stale" data-path="org1/article-body/door.jpg" />',
    author: null,
    comments: [],
    likes: [],
    acknowledgments: [],
    _count: { likes: 0, comments: 0 },
  };

  const build = () => {
    const prisma = {
      knowledgeArticle: { findFirst: jest.fn().mockResolvedValue(ARTICLE) },
      belongingSettings: { findUnique: jest.fn().mockResolvedValue({ knowledgeCenterEnabled: true }) },
      userOrg: { findFirst: jest.fn().mockResolvedValue({ id: 'm1', memberSince: new Date() }) },
    };
    const storage = {
      signedAttachmentUrls: jest.fn(async (paths: string[]) =>
        new Map(paths.map((p) => [p, `https://signed/${p}?token=fresh`])),
      ),
      signedAttachmentUrl: jest.fn(async (p: string) => `https://signed/${p}?token=fresh`),
      uploadArticleBodyImage: jest.fn().mockResolvedValue('org1/article-body/new.jpg'),
    };
    // The real signature: prisma, settings, email, config, storage.
    const service = new KnowledgeService(
      prisma as never,
      { forOrg: jest.fn().mockResolvedValue({ knowledgeCenterEnabled: true, requiredReadingGraceDays: 30 }) } as never,
      { send: jest.fn() } as never,
      { get: jest.fn() } as never,
      storage as never,
    );
    return { service, prisma, storage };
  };

  it('signs the pictures inside the words, not only the cover', async () => {
    const { service, storage } = build();

    const article = (await service.get('org1', 'a1', 'm1', true)) as { body: string };

    expect(article.body).toContain('token=fresh');
    expect(article.body).not.toContain('token=stale');
    // The durable half survives the round trip.
    expect(article.body).toContain('data-path="org1/article-body/door.jpg"');

    // One call for the cover and the body together, not one each.
    expect(storage.signedAttachmentUrls).toHaveBeenCalledTimes(1);
    expect(storage.signedAttachmentUrls.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['org1/article-covers/cover.jpg', 'org1/article-body/door.jpg']),
    );
  });

  it('refuses to file a picture against an article in another co-op', async () => {
    // The id comes from the URL and is not to be trusted (SEC-04).
    const { service, prisma, storage } = build();
    prisma.knowledgeArticle.findFirst.mockResolvedValue(null);

    await expect(service.addBodyImage('org1', 'a1', 'data', 'image/png')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.uploadArticleBodyImage).not.toHaveBeenCalled();
  });

  it('hands the editor the path to keep and a link to show', async () => {
    const { service } = build();

    const stored = await service.addBodyImage('org1', 'a1', 'data:image/png;base64,AAAA', 'image/png');

    expect(stored.path).toBe('org1/article-body/new.jpg');
    expect(stored.url).toContain('token=fresh');
  });
});
