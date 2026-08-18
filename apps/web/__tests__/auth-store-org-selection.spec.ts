import { useAuthStore } from '@/lib/auth-store';
import { api } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  api: { auth: { profile: jest.fn() } },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

/**
 * The selected org has to be one you are actually in.
 *
 * `init` restores `maybeos_org` from localStorage before the profile arrives,
 * and the old check was `!currentOrgId` — is anything selected — rather than
 * whether the selection was one of *this person's* orgs. A stale id therefore
 * survived indefinitely, and because every org-scoped request answered 403
 * "Not a member of this organization", the app was unusable with no way out:
 * every screen that could change the selection is itself org-scoped.
 *
 * Found on 2026-08-18, when a dev org id (Sunrise) left in a browser pointed
 * at production made a *successful* invitation acceptance look broken. The
 * same trap catches an org that has since been deleted — `prod-write-probe`
 * tears one down on every run — and a membership revoked mid-session.
 */
describe('auth store — which org is selected', () => {
  const profile = api.auth.profile as jest.Mock;

  const withOrgs = (orgIds: string[]) => ({
    id: 'charley',
    name: 'Charley Miller',
    orgs: orgIds.map((orgId) => ({ orgId, role: 'MEMBER' })),
  });

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    useAuthStore.setState({ token: 'tok', user: null, currentOrgId: null, isLoading: true });
  });

  it('replaces an org the person does not belong to', async () => {
    // The exact shape of the incident: a dev org id in a production browser.
    useAuthStore.setState({ currentOrgId: 'caa6cb05-dev-sunrise' });
    profile.mockResolvedValue(withOrgs(['fadda8be-maybeitsfate']));

    await useAuthStore.getState().loadProfile();

    expect(useAuthStore.getState().currentOrgId).toBe('fadda8be-maybeitsfate');
  });

  it('keeps a selection that is still valid, so switching org is not undone on reload', async () => {
    useAuthStore.setState({ currentOrgId: 'org-b' });
    profile.mockResolvedValue(withOrgs(['org-a', 'org-b']));

    await useAuthStore.getState().loadProfile();

    expect(useAuthStore.getState().currentOrgId).toBe('org-b');
  });

  it('still selects the first org when nothing was selected', async () => {
    profile.mockResolvedValue(withOrgs(['org-a', 'org-b']));

    await useAuthStore.getState().loadProfile();

    expect(useAuthStore.getState().currentOrgId).toBe('org-a');
  });

  it('clears a stale selection when the person belongs to nothing', async () => {
    // Leaving it set would be a guaranteed 403 on every request.
    useAuthStore.setState({ currentOrgId: 'org-gone' });
    localStorage.setItem('maybeos_org', 'org-gone');
    profile.mockResolvedValue(withOrgs([]));

    await useAuthStore.getState().loadProfile();

    expect(useAuthStore.getState().currentOrgId).toBeNull();
    expect(localStorage.getItem('maybeos_org')).toBeNull();
  });
});
