import { ConfigService } from '@nestjs/config';
import { StorageHealthIndicator } from '../storage.health';

/**
 * Whether this deployment can reach its buckets is reported, not guessed.
 *
 * Both storage paths swallow their own failures on purpose — one unreachable
 * avatar must not fail the member, one failed attachment must not fail the
 * post — so a revoked key is invisible from the outside. This is the only
 * thing that says so.
 */
describe('StorageHealthIndicator', () => {
  const indicator = (env: Record<string, string | undefined>) =>
    new StorageHealthIndicator({ get: (k: string) => env[k] } as unknown as ConfigService);

  const withFetch = async (impl: jest.Mock, env: Record<string, string | undefined>) => {
    const original = global.fetch;
    global.fetch = impl as unknown as typeof fetch;
    try {
      return await indicator(env).isHealthy('storage');
    } finally {
      global.fetch = original;
    }
  };

  const configured = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x',
  };

  it('says so when storage was never configured', async () => {
    const result = await indicator({}).isHealthy('storage');

    expect(result.storage).toMatchObject({ status: 'up', configured: false, reachable: false });
  });

  it('separates "configured and rejected" from "not configured"', async () => {
    // The live failure this was written for: a key Storage will not accept.
    const result = await withFetch(
      jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }),
      configured,
    );

    expect(result.storage).toMatchObject({ configured: true, reachable: false, httpStatus: 400 });
    // Not `status`: that key is Terminus's own, and writing to it replaced
    // "up" with 400 — a reported check reading as a broken one.
    expect(result.storage.status).toBe('up');
  });

  it('reports which buckets exist when the key is accepted', async () => {
    const result = await withFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ id: 'org-logos' }, { id: 'attachments' }, { id: 'avatars' }],
      }),
      configured,
    );

    expect(result.storage).toMatchObject({
      reachable: true,
      buckets: ['attachments', 'avatars', 'org-logos'],
    });
  });

  it('never fails the probe, whatever storage does', async () => {
    // A co-op that cannot attach a photo is still running its membership.
    const result = await withFetch(jest.fn().mockRejectedValue(new Error('boom')), configured);

    expect(result.storage.status).toBe('up');
    expect(result.storage).toMatchObject({ reachable: false });
  });

  it('exposes no credential', async () => {
    const result = await withFetch(
      jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }),
      configured,
    );

    expect(JSON.stringify(result)).not.toContain('sb_secret_x');
  });
});
