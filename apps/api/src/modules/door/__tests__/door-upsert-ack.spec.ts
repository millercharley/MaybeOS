import { ServiceUnavailableException } from '@nestjs/common';
import { DoorScriptService } from '../door-script.service';

/**
 * An answer that counts nothing is not an answer (DOR-03).
 *
 * Every count was read with `?? 0`, so a deployment that does not implement
 * `upsert` replied with none of the fields, all four counts became zero,
 * `rejected` was zero too, and the sync looked perfect. MaybeItsFate ran that
 * way: 463 members' codes recorded as delivered to a sheet that had never
 * heard of them, every member denied at the door, and nothing anywhere said
 * so — the deployed script was an older version than the repository's, which
 * is the state a co-op is in until somebody does Deploy → Manage deployments
 * → New version.
 */
describe('what counts as the door script having answered', () => {
  const URL =
    'https://script.google.com/macros/s/AKfycbwFsi2kkOCBa5_k3XVBv9XAXeXMJe9c0QQ3aOpACaxyG2KvJHFyX5XFTi22Ce9uldR1lA/exec';
  const MEMBERS = [{ email: 'a@example.com', code: 'TABLE', name: 'A', revoked: false }];

  const serviceReplying = (reply: Record<string, unknown>) => {
    const service = new DoorScriptService();
    // The HTTP call itself is exercised elsewhere; this is about what the
    // service makes of a reply.
    (service as unknown as { send: unknown }).send = async () => reply;
    return service;
  };

  it('accepts a reply that counts what it did', async () => {
    const service = serviceReplying({ ok: true, added: 1, updated: 0, unchanged: 0, rejected: 0 });

    await expect(service.upsert(URL, 'secret', MEMBERS)).resolves.toMatchObject({ added: 1 });
  });

  it('accepts a quiet pass, where nothing changed', async () => {
    // Zero added and zero updated is normal; it is still an acknowledgement.
    const service = serviceReplying({ ok: true, added: 0, updated: 0, unchanged: 12, rejected: 0 });

    await expect(service.upsert(URL, 'secret', MEMBERS)).resolves.toMatchObject({ unchanged: 12 });
  });

  it('accepts a reply that only reports refusals', async () => {
    const service = serviceReplying({ ok: true, rejected: 3 });

    await expect(service.upsert(URL, 'secret', MEMBERS)).resolves.toMatchObject({ rejected: 3 });
  });

  it('refuses a reply that acknowledges no field at all — the whole bug', async () => {
    const service = serviceReplying({ ok: true });

    await expect(service.upsert(URL, 'secret', MEMBERS)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('says what to do about it, since the fix is a redeploy', async () => {
    const service = serviceReplying({ ok: true });

    await expect(service.upsert(URL, 'secret', MEMBERS)).rejects.toThrow(
      /Manage deployments/,
    );
  });

  it('does not read an older script’s silence as zero changes', async () => {
    // The specific lie: `{ok: true}` once became {added:0, updated:0,
    // unchanged:0, rejected:0}, which is indistinguishable from a healthy
    // quiet pass.
    const service = serviceReplying({ ok: true });

    await expect(service.upsert(URL, 'secret', MEMBERS)).rejects.toThrow();
  });
});
