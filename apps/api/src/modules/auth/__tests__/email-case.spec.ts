import { AuthService } from '../auth.service';

/**
 * Signing in with a capital letter (AUTH-07).
 *
 * A member of MaybeItsFate typed their own address with a capital J. All
 * three ways into MaybeOS compared it exactly, so:
 *
 *   * the password login found nobody,
 *   * the magic link found nobody and said nothing, by design, and
 *   * registration's "already exists" check missed — so he was given a
 *     second account, found no co-op on it, and was offered one of his own.
 *
 * He took it, and MaybeItsFate acquired a duplicate of itself. These assert
 * the service normalises, because a helper nobody calls passes every test it
 * has — which is exactly the shape the three existing `normalizeEmail`
 * copies had while auth sat beside them doing none of it.
 */
describe('one spelling of an address', () => {
  function build() {
    const findUnique = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'u1', email: 'x', passwordHash: 'h' });
    const update = jest.fn().mockResolvedValue({});

    const service = new AuthService(
      { user: { findUnique, create, update } } as never,
      { sign: () => 'jwt' } as never,
      { sendMagicLink: jest.fn(), sendPasswordSet: jest.fn() } as never,
      { get: () => 'https://maybeos.org' } as never,
    );

    return { service, findUnique, create };
  }

  const TYPED = '  Jonleecope@BellSouth.net ';
  const STORED = 'jonleecope@bellsouth.net';

  it('finds the account when a password sign-in capitalises it', async () => {
    const { service, findUnique } = build();
    await service.validateUser(TYPED, 'hunter2');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: STORED } }),
    );
  });

  /** The one that fails in silence, and so is never reported as a fault. */
  it('finds the account when a magic link request capitalises it', async () => {
    const { service, findUnique } = build();
    await service.sendMagicLink(TYPED);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: STORED } }),
    );
  });

  describe('registering', () => {
    it('recognises an address that already exists in another case', async () => {
      const { service, findUnique } = build();
      findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.register(TYPED, 'hunter2')).rejects.toThrow(/already exists/i);
      expect(findUnique).toHaveBeenCalledWith({ where: { email: STORED } });
    });

    it('stores the address as it will be looked up', async () => {
      // Storing what was typed is what let two spellings become two people.
      const { service, create } = build();
      await service.register(TYPED, 'hunter2', 'Jon');

      expect(create.mock.calls[0][0].data.email).toBe(STORED);
    });
  });

  it('still keeps two genuinely different people apart', async () => {
    const { service, findUnique } = build();
    await service.validateUser('someone@other.org', 'hunter2');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'someone@other.org' } }),
    );
  });
});
