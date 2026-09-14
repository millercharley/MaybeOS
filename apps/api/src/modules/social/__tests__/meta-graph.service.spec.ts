import { createHmac } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GRAPH_VERSION, MetaApiError, MetaGraphService } from '../meta-graph.service';

/**
 * The Graph API calls behind sharing (SOC-01), with `fetch` replaced.
 *
 * What matters most: Page tokens never appear in a URL, every call carries
 * the app secret proof, and an Instagram collaborator invite that fails does
 * not stop the post.
 */
describe('MetaGraphService', () => {
  const env: Record<string, string> = {
    META_APP_ID: 'app-1',
    META_APP_SECRET: 'app-secret',
    META_REDIRECT_URI: 'https://maybeos.org/api/social/meta/callback',
  };
  const service = new MetaGraphService({ get: (k: string) => env[k] } as unknown as ConfigService);
  service.pollDelayMs = 0;

  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const fail = (code: number, message: string) =>
    Promise.resolve(new Response(JSON.stringify({ error: { code, message } }), { status: 400 }));
  const call = (i: number) => {
    const [url, init] = fetchMock.mock.calls[i];
    return { url: String(url), init, body: new URLSearchParams(init.body ?? '') };
  };
  const proof = (token: string) => createHmac('sha256', 'app-secret').update(token).digest('hex');

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('builds the Facebook Login address with the scopes and the signed state', () => {
    const url = new URL(service.authUrl('signed-state'));
    expect(url.origin + url.pathname).toBe(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('redirect_uri')).toBe(env.META_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
    expect(url.searchParams.get('scope')).toContain('pages_manage_posts');
  });

  it('refuses when the server has no Facebook app configured', () => {
    const bare = new MetaGraphService({ get: () => undefined } as unknown as ConfigService);
    expect(() => bare.authUrl('s')).toThrow(ServiceUnavailableException);
  });

  it('trades the code for a long-lived token, then lists Pages the admin can post to', async () => {
    fetchMock
      .mockReturnValueOnce(ok({ access_token: 'short' }))
      .mockReturnValueOnce(ok({ access_token: 'long' }))
      .mockReturnValueOnce(
        ok({
          data: [
            { id: '111', name: 'MaybeItsFate', access_token: 'page-token', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: '999', username: 'maybeitsfate' } },
            { id: '222', name: 'Analytics only', access_token: 't2', tasks: ['ANALYZE'] },
          ],
        }),
      );

    const pages = await service.pagesForCode('the-code');

    expect(pages).toEqual([{ id: '111', name: 'MaybeItsFate', token: 'page-token', igUserId: '999', igUsername: 'maybeitsfate' }]);
    expect(call(1).url).toContain('fb_exchange_token=short');
    const list = call(2);
    expect(list.url).not.toContain('long');
    expect(list.init.headers).toEqual({ Authorization: 'OAuth long' });
    expect(list.url).toContain(`appsecret_proof=${proof('long')}`);
  });

  it('posts a photo to the Page with the token in the body, never the URL', async () => {
    fetchMock
      .mockReturnValueOnce(ok({ id: 'photo-1', post_id: '111_555' }))
      .mockReturnValueOnce(ok({ permalink_url: 'https://facebook.com/111/posts/555' }));

    const result = await service.publishToPage(
      { id: '111', token: 'page-token' },
      { message: 'Hello', link: 'https://maybeos.org/e', imageUrl: 'https://cdn/x.jpg' },
    );

    expect(result).toEqual({ id: '111_555', permalink: 'https://facebook.com/111/posts/555' });
    const post = call(0);
    expect(post.url).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/111/photos`);
    expect(post.url).not.toContain('page-token');
    expect(post.body.get('access_token')).toBe('page-token');
    expect(post.body.get('appsecret_proof')).toBe(proof('page-token'));
    expect(post.body.get('url')).toBe('https://cdn/x.jpg');
  });

  it('makes a link post when the event has no picture', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: '111_7' })).mockReturnValueOnce(ok({}));
    await service.publishToPage({ id: '111', token: 't' }, { message: 'Hi', link: 'https://maybeos.org/e' });
    expect(call(0).url).toMatch(/\/111\/feed$/);
    expect(call(0).body.get('link')).toBe('https://maybeos.org/e');
  });

  it('publishes to Instagram with the host invited as collaborator', async () => {
    fetchMock
      .mockReturnValueOnce(ok({ id: 'container-1' }))
      .mockReturnValueOnce(ok({ status_code: 'IN_PROGRESS' }))
      .mockReturnValueOnce(ok({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(ok({ id: 'media-1' }))
      .mockReturnValueOnce(ok({ permalink: 'https://instagram.com/p/abc' }));

    const result = await service.publishToInstagram(
      { igUserId: '999', token: 'page-token' },
      { imageUrl: 'https://cdn/x.jpg', caption: 'Caption', collaborator: 'janedoe' },
    );

    expect(result).toEqual({ id: 'media-1', permalink: 'https://instagram.com/p/abc', collaboratorInvited: true });
    expect(call(0).body.get('collaborators')).toBe('["janedoe"]');
    expect(call(3).url).toMatch(/\/999\/media_publish$/);
    expect(call(3).body.get('creation_id')).toBe('container-1');
  });

  it('posts without the invite when Instagram refuses the collaborator', async () => {
    fetchMock
      .mockReturnValueOnce(fail(100, 'Invalid collaborator'))
      .mockReturnValueOnce(ok({ id: 'container-2' }))
      .mockReturnValueOnce(ok({ status_code: 'FINISHED' }))
      .mockReturnValueOnce(ok({ id: 'media-2' }))
      .mockReturnValueOnce(ok({}));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await service.publishToInstagram(
      { igUserId: '999', token: 't' },
      { imageUrl: 'https://cdn/x.jpg', caption: 'C', collaborator: 'private.person' },
    );

    expect(result.collaboratorInvited).toBe(false);
    expect(call(1).body.has('collaborators')).toBe(false);
  });

  it('does not retry when the token itself is dead', async () => {
    fetchMock.mockReturnValueOnce(fail(190, 'Error validating access token'));
    const attempt = service.publishToInstagram({ igUserId: '999', token: 't' }, { imageUrl: 'u', caption: 'c', collaborator: 'x' });
    await expect(attempt).rejects.toMatchObject({ tokenInvalid: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops when Instagram cannot process the picture', async () => {
    fetchMock.mockReturnValueOnce(ok({ id: 'c' })).mockReturnValueOnce(ok({ status_code: 'ERROR' }));
    await expect(
      service.publishToInstagram({ igUserId: '999', token: 't' }, { imageUrl: 'u', caption: 'c' }),
    ).rejects.toBeInstanceOf(MetaApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
