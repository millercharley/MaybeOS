import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash, createHmac } from 'crypto';
import { runInNewContext } from 'vm';
import { ServiceUnavailableException } from '@nestjs/common';
import { DoorScriptService } from '../door-script.service';
import { isDoorScriptUrl, signDoorRequest } from '../door-script';

/**
 * The signed requests MaybeOS sends to a co-op's door Apps Script (DOR-01).
 *
 * The first block runs the real `integrations/door-sheet/Code.gs` under
 * stand-ins for Google's services. A signature MaybeOS makes has to verify in
 * that file, and a signature it rejects has to be rejected there too: two
 * implementations that each pass their own tests can still disagree about
 * the bytes being signed.
 */

const CODE_GS = join(__dirname, '../../../../../../integrations/door-sheet/Code.gs');
const URL = 'https://script.google.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAXeXMJe9c0QQ3aOpACaxyG2KvJHFyX5XFTi22Ce9uldR1lA/exec';

function appsScript(secret: string | null) {
  const toSigned = (buf: Buffer) => [...buf].map((b) => (b > 127 ? b - 256 : b));
  const context: Record<string, unknown> = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k: string) => (k === 'MAYBEOS_SECRET' ? secret : null) }),
    },
    Utilities: {
      Charset: { UTF_8: 'UTF-8' },
      DigestAlgorithm: { SHA_256: 'SHA-256' },
      computeHmacSha256Signature: (value: string, key: string, charset: string) => {
        expect(charset).toBe('UTF-8');
        return toSigned(createHmac('sha256', Buffer.from(key, 'utf8')).update(Buffer.from(value, 'utf8')).digest());
      },
      base64Encode: (bytes: number[]) => Buffer.from(bytes.map((b) => b & 255)).toString('base64'),
      computeDigest: (_a: string, v: string) => toSigned(createHash('sha256').update(v).digest()),
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ setMimeType: () => JSON.parse(text) }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined }) },
  };
  runInNewContext(readFileSync(CODE_GS, 'utf8'), context);
  const doPost = context.doPost as (e: unknown) => { ok: boolean; error?: string; members?: number };
  return (body: object) => doPost({ postData: { contents: JSON.stringify(body) } });
}

describe('signing, checked against the real Code.gs', () => {
  // Non-ASCII on purpose: names are signed as UTF-8 on both sides, and this
  // is where a default charset would differ.
  const SECRET = 'sëcret-from-maybeos';

  it('a request MaybeOS signs is accepted', () => {
    const post = appsScript(SECRET);
    expect(post(signDoorRequest(SECRET, { action: 'ping' }))).toEqual({ ok: true, action: 'ping', members: 0 });
  });

  it('with names outside ASCII in the payload', () => {
    const post = appsScript(SECRET);
    const request = signDoorRequest(SECRET, {
      action: 'upsert',
      members: [{ email: 'zoe@example.com', code: 'ABCDE', name: 'Zoë Ñúñez', revoked: false }],
    });
    // The sheet is absent in this stand-in, so the write fails *after* the
    // signature has been accepted — anything but "unauthorized" proves it.
    expect(post(request).error).not.toBe('unauthorized');
  });

  it('a different secret is refused', () => {
    expect(appsScript('another-secret')(signDoorRequest(SECRET, { action: 'ping' })).error).toBe('unauthorized');
  });

  it('a changed payload is refused', () => {
    const request = signDoorRequest(SECRET, { action: 'ping' });
    expect(appsScript(SECRET)({ ...request, payload: request.payload.replace('ping', 'pong') }).error).toBe(
      'unauthorized',
    );
  });

  it('an old request is refused', () => {
    const request = signDoorRequest(SECRET, { action: 'ping' }, Date.now() - 10 * 60 * 1000);
    expect(appsScript(SECRET)(request).error).toBe('stale');
  });
});

describe('the script address', () => {
  it('accepts a deployed web app, including the Workspace form', () => {
    expect(isDoorScriptUrl(URL)).toBe(true);
    expect(isDoorScriptUrl('https://script.google.com/a/macros/maybeitsfate.com/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAX/exec')).toBe(true);
  });
});

describe('DoorScriptService', () => {
  const service = new DoorScriptService();
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  const reply = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(status >= 300 && status < 400 ? null : body, { status, headers });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('posts a signed body, then follows Google’s redirect with a GET', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(302, '', { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=abc' }))
      .mockResolvedValueOnce(reply(200, '{"ok":true,"action":"ping","members":7}'));

    expect(await service.ping(URL, 'secret')).toEqual({ members: 7 });

    const [firstUrl, first] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe(URL);
    expect(first).toMatchObject({ method: 'POST', redirect: 'manual' });
    const body = JSON.parse(first.body);
    expect(body).toEqual(expect.objectContaining({ payload: '{"action":"ping"}', signature: expect.any(String) }));

    const [secondUrl, second] = fetchMock.mock.calls[1];
    expect(String(secondUrl)).toBe('https://script.googleusercontent.com/macros/echo?user_content_key=abc');
    expect(second).toMatchObject({ method: 'GET' });
  });

  it('will not follow a redirect anywhere but Google’s response host', async () => {
    fetchMock.mockResolvedValueOnce(reply(302, '', { location: 'https://evil.example.com/collect' }));

    await expect(service.ping(URL, 'secret')).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never sends to an address that is not an Apps Script web app', async () => {
    await expect(service.ping('https://evil.example.com/exec', 'secret')).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a Google sign-in page: the web app is not open to Anyone', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, '<!DOCTYPE html><title>Sign in</title>'));
    await expect(service.ping(URL, 'secret')).rejects.toThrow(/deployed as a web app with access set to Anyone/);
  });

  it('turns the script’s refusal into something an organiser can act on', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, '{"ok":false,"error":"unauthorized"}'));
    await expect(service.ping(URL, 'secret')).rejects.toThrow(/MAYBEOS_SECRET does not match/);
  });

  it('reports the counts from an upsert', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, '{"ok":true,"action":"upsert","added":2,"updated":1,"unchanged":4,"rejected":0}'));
    expect(
      await service.upsert(URL, 'secret', [{ email: 'a@x.co', code: 'ABCDE', name: 'A', revoked: false }]),
    ).toEqual({ added: 2, updated: 1, unchanged: 4, rejected: 0 });
  });
});
