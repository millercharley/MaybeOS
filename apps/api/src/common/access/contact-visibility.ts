import { RequestUser } from '../decorators/current-user.decorator';

/**
 * Who may see another member's contact details.
 *
 * Charley's rule (2026-08-12): members must not see each other's contact
 * information. Belonging to the same co-op earns you a name and a face in the
 * directory, not everyone's email address — a co-op's member list is exactly
 * the kind of thing that should not be harvestable by anyone who joins.
 *
 * Organisers are the exception, and only because contacting members is their
 * job: chasing a lapsed subscription, confirming a booking, answering a
 * question. That is a role, not a courtesy, so it is ADMIN and STAFF only.
 *
 * Everyone always sees their own record in full. Your own email is not a leak.
 */
export function canSeeContactDetails(
  user: RequestUser | undefined,
  orgId: string,
): boolean {
  if (!user) return false;
  // Deliberately no platform-admin case (PLT-01). This function decides who
  // sees a member's email address, and whoever runs MaybeOS is not one of
  // them: a co-op's roster is the co-op's, and "the platform can read it" is
  // exactly the thing a co-op would want to be told before it moved its
  // membership here.

  const role = user.orgRoles?.[orgId];
  return role === 'ADMIN' || role === 'STAFF';
}

/** The caller, reduced to what the shaping functions need. */
export interface ContactViewer {
  userId: string;
  privileged: boolean;
}

export function viewerFor(
  user: RequestUser | undefined,
  orgId: string,
): ContactViewer {
  return {
    userId: user?.userId ?? '',
    privileged: canSeeContactDetails(user, orgId),
  };
}
