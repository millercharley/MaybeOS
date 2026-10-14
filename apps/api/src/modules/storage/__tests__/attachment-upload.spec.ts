import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from '../storage.service';

/**
 * Starting an attachment upload (STO-05).
 *
 * Charley: "The system did not upload the image to my text post… It was a
 * 600kb jpg." The size was never the problem. The request that asks Supabase
 * for a one-time upload URL sent `Content-Type: application/json` and no
 * body, and Supabase's storage API is Fastify, which answers exactly that
 * with 400:
 *
 *   Body cannot be empty when content-type is set to 'application/json'
 *
 * So it failed at the first step, for everyone, since the feature shipped.
 * MaybeItsFate has sixteen objects in the attachments bucket and not one of
 * them came through here — they are article covers and room photographs,
 * written by the byte-upload path, which sends a body and was therefore
 * fine.
 */
describe('asking Supabase for an upload URL', () => {
  const ORG = 'org-1';

  const build = (answer: { ok: boolean; status?: number; body?: unknown; text?: string }) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 400),
      json: async () => answer.body ?? { url: '/object/upload/sign/attachments/x?token=t' },
      text: async () => answer.text ?? '',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const config = {
      get: (k: string) =>
        k === 'SUPABASE_URL' ? 'https://example.supabase.co' : 'service-role-key',
    };
    return { service: new StorageService(config as never), fetchMock };
  };

  afterEach(() => jest.restoreAllMocks());

  it('sends no content type, because it sends no body', async () => {
    /*
      The whole bug. Fastify rejects a request that declares JSON and
      carries nothing, so the header has to go rather than a body be
      invented. `supabase-js` sends neither here either.
    */
    const { service, fetchMock } = build({ ok: true });

    await service.createAttachmentUploadUrl(ORG, 'image/jpeg');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(Object.keys(init.headers)).not.toContain('Content-Type');
  });

  it('still authenticates as the service role', async () => {
    // Dropping the content type must not drop the keys with it.
    const { service, fetchMock } = build({ ok: true });

    await service.createAttachmentUploadUrl(ORG, 'image/jpeg');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.apikey).toBeDefined();
    expect(init.headers.Authorization).toMatch(/^Bearer /);
  });

  it('chooses the path itself, inside this co-op', async () => {
    // The caller never names where its file lands, so a doctored request
    // cannot write into another co-op's folder.
    const { service, fetchMock } = build({ ok: true });

    const { path } = await service.createAttachmentUploadUrl(ORG, 'image/jpeg');

    expect(path).toMatch(new RegExp(`^${ORG}/[0-9a-f-]{36}\\.jpg$`));
    expect(fetchMock.mock.calls[0][0]).toContain(`/upload/sign/attachments/${path}`);
  });

  it('carries why it failed, where the report will show it', async () => {
    /*
      The reason was written to the function's log, which is not shipped to
      Sentry — so the report said "Could not start that upload. Try again."
      and nothing else, while the one fact that explained it sat somewhere
      nobody was going to look.
    */
    const { service } = build({
      ok: false,
      status: 400,
      text: "Body cannot be empty when content-type is set to 'application/json'",
    });

    const failure = await service.createAttachmentUploadUrl(ORG, 'image/jpeg').catch((e) => e);

    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    // The member reads this.
    expect(failure.message).toBe('Could not start that upload. Try again.');
    // And this rides underneath it, for whoever has to fix it.
    expect((failure.cause as Error).message).toContain('400');
    expect((failure.cause as Error).message).toContain('Body cannot be empty');
  });

  it('refuses a type the bucket would refuse, before asking', async () => {
    const { service, fetchMock } = build({ ok: true });

    await expect(service.createAttachmentUploadUrl(ORG, 'application/zip')).rejects.toThrow(
      /not accepted/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
