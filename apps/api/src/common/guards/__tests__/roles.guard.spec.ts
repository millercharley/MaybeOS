import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;
    guard = new RolesGuard(reflector);
  });

  function createMockContext(overrides: {
    user?: any;
    params?: Record<string, string>;
    query?: Record<string, string>;
    headers?: Record<string, string>;
  }): ExecutionContext {
    const request = {
      user: overrides.user,
      params: overrides.params || {},
      query: overrides.query || {},
      headers: overrides.headers || {},
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no roles are required', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext({ user: { userId: '1', orgRoles: {} } });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    reflector.getAllAndOverride.mockReturnValue([]);
    const ctx = createMockContext({ user: { userId: '1', orgRoles: {} } });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('refuses a PLATFORM_ADMIN who is not in the org (PLT-01)', () => {
    // This test asserted the opposite until 2026-08-20, when the bypass was
    // removed: "platform admins can do anything" meant whoever runs MaybeOS
    // could read, edit and delete inside any co-op on it — every member list,
    // every DM — silently. Charley's rule is that member PII stays private,
    // and a bypass on the guard that keeps one co-op's roster from another is
    // the opposite of that.
    //
    // A platform admin reaches a co-op's data by being invited into it, like
    // anybody else. What they have instead is a console that answers about
    // co-ops rather than about members.
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'PLATFORM_ADMIN', orgRoles: {} },
      params: { orgId: 'org-1' },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('lets a PLATFORM_ADMIN through where they actually are a member', () => {
    // The global role neither grants nor removes anything; their org role does
    // all the work, exactly as it would for anybody else.
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'PLATFORM_ADMIN', orgRoles: { 'org-1': 'ADMIN' } },
      params: { orgId: 'org-1' },
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow user with matching org role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN', 'STAFF']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-1': 'ADMIN' } },
      params: { orgId: 'org-1' },
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should deny user without matching org role', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-1': 'MEMBER' } },
      params: { orgId: 'org-1' },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should deny user with no membership in the org', () => {
    reflector.getAllAndOverride.mockReturnValue(['MEMBER']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-2': 'ADMIN' } },
      params: { orgId: 'org-1' },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should resolve orgId from query params', () => {
    reflector.getAllAndOverride.mockReturnValue(['MEMBER']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-1': 'MEMBER' } },
      query: { orgId: 'org-1' },
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should resolve orgId from x-org-id header', () => {
    reflector.getAllAndOverride.mockReturnValue(['STAFF']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-1': 'STAFF' } },
      headers: { 'x-org-id': 'org-1' },
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw if no user on request', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const ctx = createMockContext({
      user: undefined,
      params: { orgId: 'org-1' },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should throw if no orgId can be resolved', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMIN']);
    const ctx = createMockContext({
      user: { userId: '1', globalRole: 'USER', orgRoles: { 'org-1': 'ADMIN' } },
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
