import { resolveAvatars } from '../avatars/resolve-avatars';
import { StorageService } from '../../modules/storage/storage.service';

/**
 * Signing avatars wherever they turn up in a payload (MEM-10).
 */
describe('resolveAvatars', () => {
  const storage = (map: Record<string, string> = {}) =>
    ({
      signedAvatarUrls: jest.fn().mockResolvedValue(new Map(Object.entries(map))),
    }) as unknown as StorageService;

  it('signs an avatar however deeply it is nested', async () => {
    const payload = {
      data: [
        {
          author: { id: 'u1', avatarUrl: null, avatarPath: 'u1/a.jpg' },
          comments: [
            {
              author: { id: 'u2', avatarUrl: null, avatarPath: 'u2/b.jpg' },
              replies: [{ author: { id: 'u3', avatarUrl: null, avatarPath: 'u3/c.jpg' } }],
            },
          ],
        },
      ],
    };

    await resolveAvatars(
      storage({ 'u1/a.jpg': 'signed-1', 'u2/b.jpg': 'signed-2', 'u3/c.jpg': 'signed-3' }),
      payload,
    );

    expect(payload.data[0].author.avatarUrl).toBe('signed-1');
    expect(payload.data[0].comments[0].author.avatarUrl).toBe('signed-2');
    // A reply to a comment is where the old per-shape approach ran out.
    expect(payload.data[0].comments[0].replies[0].author.avatarUrl).toBe('signed-3');
  });

  it('signs once for the whole payload, not once per face', async () => {
    const svc = storage({ 'u1/a.jpg': 'signed-1' });
    const payload = [
      { user: { avatarPath: 'u1/a.jpg' } },
      { user: { avatarPath: 'u1/a.jpg' } },
    ];

    await resolveAvatars(svc, payload);

    expect(svc.signedAvatarUrls).toHaveBeenCalledTimes(1);
  });

  it('never publishes the storage path', async () => {
    const payload = { user: { avatarPath: 'u1/a.jpg', avatarUrl: null } };

    await resolveAvatars(storage({ 'u1/a.jpg': 'signed' }), payload);

    expect(payload.user).not.toHaveProperty('avatarPath');
  });

  it('leaves the existing URL alone when a file cannot be signed', async () => {
    // A deleted file should cost a member their photo, not their whole face.
    const payload = { user: { avatarPath: 'gone.jpg', avatarUrl: 'https://old.example/a.jpg' } };

    await resolveAvatars(storage({}), payload);

    expect(payload.user.avatarUrl).toBe('https://old.example/a.jpg');
    expect(payload.user).not.toHaveProperty('avatarPath');
  });

  it('does not call storage at all when nothing was imported', async () => {
    const svc = storage();

    await resolveAvatars(svc, { data: [{ user: { id: 'u1', avatarUrl: 'https://x/a.jpg' } }] });

    expect(svc.signedAvatarUrls).not.toHaveBeenCalled();
  });

  it('walks past Dates and other non-plain objects rather than into them', async () => {
    const payload = {
      createdAt: new Date('2026-01-01'),
      body: Buffer.from('bytes'),
      user: { avatarPath: 'u1/a.jpg' },
    };

    await resolveAvatars(storage({ 'u1/a.jpg': 'signed' }), payload);

    expect(payload.createdAt).toBeInstanceOf(Date);
    expect((payload.user as { avatarUrl?: string }).avatarUrl).toBe('signed');
  });

  it('survives a payload that refers to itself', async () => {
    const node: Record<string, unknown> = { user: { avatarPath: 'u1/a.jpg' } };
    node.self = node;

    await expect(resolveAvatars(storage({ 'u1/a.jpg': 'signed' }), node)).resolves.toBeDefined();
  });
});
