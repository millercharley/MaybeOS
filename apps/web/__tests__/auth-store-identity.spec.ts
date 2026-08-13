import { useAuthStore } from '@/lib/auth-store';

/**
 * Signing in as somebody else replaces who the app thinks you are.
 *
 * `AuthProvider` only loads a profile when there isn't one (`token && !user`),
 * so a second sign-in in the same browser left the previous person's name,
 * role and org on screen. Found while verifying IMP-16: an admin signed in
 * after a member, landed on /admin, and was shown the member's nav, the
 * member's name, and "This page is for organisers".
 *
 * The API was never fooled — every request carried the new token — but a UI
 * that displays the wrong person is its own problem.
 */
describe('auth store — switching accounts', () => {
  /** A JWT-shaped string; only the payload's `sub` is ever read. */
  const tokenFor = (sub: string) =>
    ['header', btoa(JSON.stringify({ sub, email: `${sub}@example.com` })), 'sig'].join('.');

  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null, currentOrgId: null, isLoading: false });
  });

  it('drops the previous profile when a different person signs in', () => {
    useAuthStore.setState({
      token: tokenFor('alex'),
      user: { id: 'alex', name: 'Alex Thompson', orgs: [] } as never,
      currentOrgId: 'org-1',
    });

    useAuthStore.getState().setToken(tokenFor('maya'));

    // Null rather than stale: AuthProvider refetches precisely when there is
    // no user, so this is what makes the reload happen.
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('forgets the org the previous person had selected', () => {
    // It may not even be an org the new account belongs to.
    useAuthStore.setState({
      token: tokenFor('alex'),
      user: { id: 'alex', orgs: [] } as never,
      currentOrgId: 'org-1',
    });
    localStorage.setItem('maybeos_org', 'org-1');

    useAuthStore.getState().setToken(tokenFor('maya'));

    expect(useAuthStore.getState().currentOrgId).toBeNull();
    expect(localStorage.getItem('maybeos_org')).toBeNull();
  });

  it('keeps the selected org when the same account gets a fresh token', () => {
    // Creating an org refreshes the token to pick up the new role. Losing
    // which org you were looking at there would be a regression.
    useAuthStore.setState({
      token: tokenFor('alex'),
      user: { id: 'alex', orgs: [] } as never,
      currentOrgId: 'org-1',
    });

    useAuthStore.getState().setToken(tokenFor('alex'));

    expect(useAuthStore.getState().currentOrgId).toBe('org-1');
    // Still reloaded, because the point of that refresh is new roles.
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('stores the new token either way', () => {
    useAuthStore.getState().setToken(tokenFor('maya'));

    expect(localStorage.getItem('maybeos_token')).toBe(tokenFor('maya'));
    expect(useAuthStore.getState().token).toBe(tokenFor('maya'));
  });

  it('treats an unreadable token as a different person rather than trusting it', () => {
    // The safe direction: refetch. Nothing is granted on the strength of this
    // read — the API verifies the token itself.
    useAuthStore.setState({
      token: tokenFor('alex'),
      user: { id: 'alex', orgs: [] } as never,
      currentOrgId: 'org-1',
    });

    useAuthStore.getState().setToken('not-a-jwt');

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().currentOrgId).toBeNull();
  });
});
