import { PrismaService } from '../prisma.service';

/**
 * A container does not take a database connection until it needs one
 * (OPS-36).
 *
 * On 2026-10-28 a deploy produced 132 × 502 in an hour, ending in
 * `FATAL: (EMAXCONN) max client connections reached, limit: 200`. The shape
 * of it: a deploy makes every Lambda container cold, one dashboard load fans
 * out to about fifteen concurrent requests, each wakes its own container, and
 * each container opened a connection in `onModuleInit` before knowing whether
 * it would query anything at all.
 *
 * `JwtStrategy.validate` decodes the token and touches nothing, so every 401
 * took a connection and handed it straight back — about an eighth of all
 * traffic. CORS preflights likewise. Under a burst those are connections
 * taken from requests that need one.
 *
 * This is a test about a line that must *not* be there, so it asserts on the
 * absence directly. The regression it guards is somebody re-adding
 * `$connect()` for the entirely reasonable-sounding reason that a service
 * should connect when it starts.
 */
describe('PrismaService connection lifecycle', () => {
  const build = () => {
    const service = Object.create(PrismaService.prototype) as PrismaService;
    const connect = jest.fn().mockResolvedValue(undefined);
    const disconnect = jest.fn().mockResolvedValue(undefined);
    Object.assign(service, { $connect: connect, $disconnect: disconnect });
    return { service, connect, disconnect };
  };

  it('does not connect when the module starts', async () => {
    const { service, connect } = build();

    await service.onModuleInit();

    expect(connect).not.toHaveBeenCalled();
  });

  /**
   * The other half, and the one that actually returns a connection: the
   * scheduled function closes its Nest app between ticks (D-022), and this is
   * what hands the connection back when it does.
   */
  it('disconnects when the module is destroyed', async () => {
    const { service, disconnect } = build();

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  /** Both hooks still exist, so Nest calls them and neither is quietly lost. */
  it('keeps both lifecycle hooks', () => {
    expect(typeof PrismaService.prototype.onModuleInit).toBe('function');
    expect(typeof PrismaService.prototype.onModuleDestroy).toBe('function');
  });
});
