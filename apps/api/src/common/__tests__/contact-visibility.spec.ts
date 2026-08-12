import { canSeeContactDetails, viewerFor } from '../access/contact-visibility';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * Members must not see each other's contact information (Charley, 2026-08-12).
 *
 * Every member-visible list used to carry `user.email`: the member directory,
 * the room's booking list, an event's attendee list. Belonging to the same
 * co-op made the whole membership harvestable by anyone who joined.
 *
 * Organisers are the exception — contacting members is their job — so the
 * predicate is ADMIN and STAFF, and everyone always sees their own record.
 */
describe('contact visibility', () => {
  const ORG = 'org-1';
  const user = (role?: string, globalRole = 'USER'): RequestUser => ({
    userId: 'user-1',
    email: 'someone@example.com',
    globalRole,
    orgRoles: role ? { [ORG]: role } : {},
  });

  it.each(['ADMIN', 'STAFF'])('lets a %s see contact details', (role) => {
    expect(canSeeContactDetails(user(role), ORG)).toBe(true);
  });

  it.each(['MEMBER', 'GUEST'])('does not let a %s see them', (role) => {
    expect(canSeeContactDetails(user(role), ORG)).toBe(false);
  });

  it('is scoped to the org being asked about, not any org', () => {
    // An admin of one co-op is an ordinary reader of another. The guard only
    // proves membership of the org in the URL — which the caller chooses — so
    // the role has to be looked up under that same id.
    const adminElsewhere: RequestUser = {
      userId: 'user-1',
      email: 'someone@example.com',
      globalRole: 'USER',
      orgRoles: { 'some-other-org': 'ADMIN', [ORG]: 'MEMBER' },
    };

    expect(canSeeContactDetails(adminElsewhere, ORG)).toBe(false);
    expect(canSeeContactDetails(adminElsewhere, 'some-other-org')).toBe(true);
  });

  it('lets platform admins through, so support can unstick a co-op', () => {
    expect(canSeeContactDetails(user(undefined, 'PLATFORM_ADMIN'), ORG)).toBe(true);
  });

  it('refuses an absent caller rather than defaulting open', () => {
    expect(canSeeContactDetails(undefined, ORG)).toBe(false);
  });

  it('carries the caller id, so a member still sees their own record', () => {
    expect(viewerFor(user('MEMBER'), ORG)).toEqual({
      userId: 'user-1',
      privileged: false,
    });
  });
});
