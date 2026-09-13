import { api } from '@/lib/api';

/**
 * What actually goes on the wire when an event is edited (EVT-21, EVT-22).
 *
 * `toUpdatePayload` has existed since the first time this broke, and the bug
 * came back anyway — because the rule lived in the *caller*, and a new caller
 * did not know about it. My Events got an Edit button and sent the form's
 * values straight through; the API answered "property publish should not
 * exist" and saved nothing, which is what Charley saw while adding a picture
 * to his event.
 *
 * So the strip moved into the client, and this is the test of the thing
 * itself rather than of a helper somebody has to remember to call.
 */
describe('PATCH event request body', () => {
  const realFetch = global.fetch;
  let sent: Record<string, unknown>;

  beforeEach(() => {
    sent = {};
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      sent = JSON.parse(init?.body ?? '{}');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ id: 'event-1' }),
        text: async () => '{"id":"event-1"}',
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const values = {
    title: 'Print night',
    description: 'Bring a block.',
    startTime: '2026-10-01T23:00:00.000Z',
    endTime: '2026-10-02T01:00:00.000Z',
    visibility: 'MEMBERS_ONLY',
    imageUrl: 'https://images.unsplash.com/abc?w=1080',
    imageCredit: 'Ada Potter',
    imageCreditUrl: 'https://unsplash.com/@ada?utm_source=MaybeOS&utm_medium=referral',
    publish: true,
  };

  it('never sends publish, whatever the caller passed', async () => {
    await api.events.update('org-1', 'event-1', values, 'token');

    expect(sent).not.toHaveProperty('publish');
  });

  it('still sends everything the edit was for', async () => {
    await api.events.update('org-1', 'event-1', values, 'token');

    expect(sent).toMatchObject({
      title: 'Print night',
      visibility: 'MEMBERS_ONLY',
      // The picture is the edit that found this bug; dropping it while
      // dropping `publish` would be the same failure wearing a new hat.
      imageUrl: 'https://images.unsplash.com/abc?w=1080',
      imageCredit: 'Ada Potter',
    });
  });

  it('leaves a body that never had publish alone', async () => {
    await api.events.update('org-1', 'event-1', { title: 'Just the title' }, 'token');

    expect(sent).toEqual({ title: 'Just the title' });
  });
});
