import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * Baseline tenant-isolation check for any route with an :orgId param: the
 * authenticated caller must actually belong to that org (any role), or be
 * a platform admin. RolesGuard only checks *specific* roles, and only when
 * a route opts in via @Roles(...) — routes with no @Roles() decorator at
 * all skip that check entirely. This guard closes that gap by enforcing
 * plain membership unconditionally, independent of @Roles().
 */
@Injectable()
export class OrgMembershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const orgId: string | undefined = request.params?.orgId;

    // No :orgId on this route (e.g. org creation) — nothing to check here.
    if (!orgId) {
      return true;
    }

    const user = request.user as RequestUser | undefined;
    if (!user) {
      throw new ForbiddenException('Missing authentication');
    }

    if (user.globalRole === 'PLATFORM_ADMIN') {
      return true;
    }

    if (!user.orgRoles?.[orgId]) {
      throw new ForbiddenException('Not a member of this organization');
    }

    return true;
  }
}
