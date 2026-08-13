import { withConnectionDefaults, CONNECTION_DEFAULTS } from '../database-url';

/**
 * The connection settings that keep production up (OPS-11, D-018).
 *
 * Prisma's default pool is `CPUs × 2 + 1` per process, every warm Lambda
 * container is a process, and Supabase's session-mode pooler allows 15 clients
 * in total — so a handful of containers exhausts it and the API returns 502 to
 * everybody, login included. That happened on 2026-08-11, was fixed inside
 * `DATABASE_URL`, and happened again on 2026-08-13 because a fix that lives
 * only in a secret is one nothing can see, test, or keep.
 *
 * These exist so the next person changing that variable finds out here rather
 * than from a production outage.
 */
describe('withConnectionDefaults', () => {
  const base = 'postgresql://user:pw@db.example.com:5432/postgres';

  it('holds a container to one connection', () => {
    // The whole point: 15 clients then means fifteen containers, not three.
    const url = new URL(withConnectionDefaults(base)!);

    expect(url.searchParams.get('connection_limit')).toBe('1');
  });

  it('sets the timeouts that stop a burst failing instantly', () => {
    const url = new URL(withConnectionDefaults(base)!);

    expect(url.searchParams.get('pool_timeout')).toBe('10');
    expect(url.searchParams.get('connect_timeout')).toBe('10');
  });

  it('keeps an explicit value already in the URL', () => {
    // A floor, not a cage: this can still be tuned from the environment
    // without a deploy.
    const url = new URL(
      withConnectionDefaults(`${base}?connection_limit=5`)!,
    );

    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.searchParams.get('pool_timeout')).toBe('10');
  });

  it('keeps the parameters the URL already carried', () => {
    // pgbouncer=true matters to Prisma and must survive untouched.
    const url = new URL(withConnectionDefaults(`${base}?pgbouncer=true&sslmode=require`)!);

    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('connection_limit')).toBe('1');
  });

  it('does not mangle the credentials or the database name', () => {
    const url = new URL(withConnectionDefaults(base)!);

    expect(url.username).toBe('user');
    expect(url.hostname).toBe('db.example.com');
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe('/postgres');
  });

  it('passes an unparseable URL through untouched', () => {
    // Prisma reports a malformed connection string far better than a helper
    // throwing a stack trace over the top of it would.
    expect(withConnectionDefaults('not-a-url')).toBe('not-a-url');
  });

  it('passes an absent URL through rather than inventing one', () => {
    expect(withConnectionDefaults(undefined)).toBeUndefined();
  });

  it('keeps the limit at 1, so raising it is a deliberate edit', () => {
    // A guard on the constant itself: this number is the difference between
    // three containers and fifteen, and it should not drift upward quietly.
    expect(CONNECTION_DEFAULTS.connection_limit).toBe('1');
  });
});
