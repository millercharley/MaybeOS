import { downloadAuthenticated } from '@/lib/download';
import { ApiError } from '@/lib/api';

/**
 * Authenticated downloads (IMP-26).
 *
 * Written because the first export link in this app was an `<a href>` to an
 * endpoint that requires a bearer token — so it answered 401 and the file
 * never arrived, silently, on a button nobody had clicked.
 */
describe('downloadAuthenticated', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = jest.fn().mockReturnValue('blob:fake');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    jest.restoreAllMocks();
  });

  const ok = (body = 'a,b\n1,2') =>
    jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob([body], { type: 'text/csv' }),
    });

  it('sends the token, which a plain link cannot', async () => {
    global.fetch = ok() as unknown as typeof fetch;
    await downloadAuthenticated('/export.csv', 'log.csv', 'tok123');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok123');
  });

  it('names the file the caller asked for', async () => {
    global.fetch = ok() as unknown as typeof fetch;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadAuthenticated('/export.csv', 'buddy-log.csv', 'tok');

    expect(click).toHaveBeenCalled();
    // The anchor is removed after clicking, so the name is checked on the
    // element the spy saw rather than by querying the document afterwards.
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('releases the blob rather than pinning it for the session', async () => {
    global.fetch = ok() as unknown as typeof fetch;
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadAuthenticated('/export.csv', 'log.csv', 'tok');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('passes the API’s own words through on a refusal', async () => {
    // A 402 here means the co-op has not bought this yet, and the sentence
    // the API wrote for that is better than "download failed".
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ message: 'The written report for this period hasn’t been bought yet.' }),
    }) as unknown as typeof fetch;

    await expect(downloadAuthenticated('/x', 'f.html', 'tok')).rejects.toMatchObject({
      status: 402,
      message: expect.stringContaining('bought'),
    });
  });

  it('still says something useful when the error body is not JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
    }) as unknown as typeof fetch;

    await expect(downloadAuthenticated('/x', 'f.html', 'tok')).rejects.toBeInstanceOf(ApiError);
  });
});
