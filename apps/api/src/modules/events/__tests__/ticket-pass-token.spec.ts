import { createHmac } from 'crypto';
import { encodeTicketPass, decodeTicketPass } from '../ticket-pass';

/**
 * The signed link that proves somebody paid (EVT-46).
 *
 * This is the only credential a ticket buyer ever holds, and the people
 * holding it have no account to fall back on — so the failure modes matter
 * more than usual. A token that verifies when it should not lets somebody
 * into a show; a token that fails when it should not leaves a paying customer
 * at a door with nothing to show.
 */
describe('ticket pass tokens', () => {
  const SECRET = 'test-secret-value';
  const EVENT = 'eb8feb3c-5378-4aca-8d25-04aaf75fabba';

  it('round-trips an event and an address', () => {
    const token = encodeTicketPass({ eventId: EVENT, email: 'netneb1958@gmail.com' }, SECRET);

    expect(decodeTicketPass(token, SECRET)).toEqual({
      eventId: EVENT,
      email: 'netneb1958@gmail.com',
    });
  });

  /**
   * The AUTH-07 bug, in the one place it would be invisible.
   *
   * Stripe returns whatever the buyer typed into the card form, and Annette
   * Neblett's two checkouts were twenty-four seconds apart — either could
   * have carried a capital. A token that distinguished them would count her
   * two seats as one each and show her "1 seat" at a door where she is
   * standing with a friend.
   */
  it('treats one address spelled two ways as one address', () => {
    const lower = encodeTicketPass({ eventId: EVENT, email: 'netneb1958@gmail.com' }, SECRET);
    const shouty = encodeTicketPass({ eventId: EVENT, email: '  NetNeb1958@Gmail.COM ' }, SECRET);

    expect(shouty).toBe(lower);
    expect(decodeTicketPass(shouty, SECRET)?.email).toBe('netneb1958@gmail.com');
  });

  it('refuses a token signed with another secret', () => {
    const token = encodeTicketPass({ eventId: EVENT, email: 'a@example.com' }, SECRET);

    expect(decodeTicketPass(token, 'a-different-secret')).toBeNull();
  });

  /**
   * The attack this exists to stop: swapping the payload for somebody else's
   * event or address while keeping a signature that was valid for the old one.
   */
  it('refuses a payload edited after signing', () => {
    const token = encodeTicketPass({ eventId: EVENT, email: 'a@example.com' }, SECRET);
    const [, signature] = token.split('.');

    const forged = Buffer.from(
      JSON.stringify({ eventId: EVENT, email: 'someone.else@example.com' }),
    ).toString('base64url');

    expect(decodeTicketPass(`${forged}.${signature}`, SECRET)).toBeNull();
  });

  it.each([
    ['nothing at all', undefined],
    ['an empty string', ''],
    ['no dot', 'justonepart'],
    ['an empty signature', 'cGF5bG9hZA==.'],
    ['a signature of the wrong length', 'cGF5bG9hZA==.abc'],
  ])('refuses %s', (_label, raw) => {
    expect(decodeTicketPass(raw as string | undefined, SECRET)).toBeNull();
  });

  /**
   * A link in an email outlives the deployment that sent it, but it must not
   * outlive the secret. Verifying against an empty secret has to fail closed —
   * a misconfigured environment that accepted every token would be an open
   * door rather than a broken page.
   */
  it('refuses everything when there is no secret to check against', () => {
    const token = encodeTicketPass({ eventId: EVENT, email: 'a@example.com' }, SECRET);

    expect(decodeTicketPass(token, '')).toBeNull();
  });

  /**
   * The same, against the forgery it actually enables.
   *
   * The test above only proves a *correctly signed* token is refused by the
   * wrong key, which an HMAC gives for free — it passed with the empty-secret
   * guard deleted. The danger is the other direction: if `JWT_SECRET` is ever
   * unset, an attacker who guesses that can sign their own tokens with the
   * empty key and every one of them verifies. This is that token.
   */
  it('refuses a token forged with the empty secret', () => {
    const payload = Buffer.from(
      JSON.stringify({ eventId: EVENT, email: 'gatecrasher@example.com' }),
    ).toString('base64url');
    const forged = `${payload}.${createHmac('sha256', '').update(payload).digest('base64url')}`;

    expect(decodeTicketPass(forged, '')).toBeNull();
  });

  it('refuses to sign without a secret, an event or an address', () => {
    expect(() => encodeTicketPass({ eventId: EVENT, email: 'a@example.com' }, '')).toThrow();
    expect(() => encodeTicketPass({ eventId: '', email: 'a@example.com' }, SECRET)).toThrow();
    expect(() => encodeTicketPass({ eventId: EVENT, email: '   ' }, SECRET)).toThrow();
  });

  /**
   * A valid signature over a payload that is not a pass.
   *
   * Only reachable if something other than `encodeTicketPass` ever signs with
   * this secret — which `JWT_SECRET` makes less hypothetical than it sounds,
   * since the unsubscribe tokens use the same one. A pass must not be
   * constructible out of an unsubscribe token's shape.
   */
  it.each([
    // An unsubscribe token's shape. Same secret signs both (`JWT_SECRET`), so
    // one must never be readable as the other.
    ['an unsubscribe token', { userOrgId: 'uo-1', purpose: 'radar' }],
    // Each field checked on its own, because a single assertion over a
    // payload missing everything passes however few of the checks survive.
    ['an eventId that is not a string', { eventId: 12345, email: 'a@example.com' }],
    ['an empty eventId', { eventId: '', email: 'a@example.com' }],
    ['an address that is not a string', { eventId: EVENT, email: { at: 'example.com' } }],
    ['an empty address', { eventId: EVENT, email: '' }],
    ['an address that is only spaces', { eventId: EVENT, email: '   ' }],
  ])('refuses a correctly signed payload with %s', (_label, body) => {
    const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');

    expect(decodeTicketPass(`${payload}.${signature}`, SECRET)).toBeNull();
  });

  /** One event's token must never open another's. */
  it('is scoped to one event', () => {
    const a = encodeTicketPass({ eventId: 'event-a', email: 'x@example.com' }, SECRET);
    const b = encodeTicketPass({ eventId: 'event-b', email: 'x@example.com' }, SECRET);

    expect(a).not.toBe(b);
    expect(decodeTicketPass(a, SECRET)?.eventId).toBe('event-a');
  });
});
