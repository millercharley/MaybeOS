import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser;
    const orgId =
      request.params.orgId || request.query.orgId || request.headers['x-org-id'];

    if (!user || !orgId) {
      throw new ForbiddenException('Missing authentication or org context');
    }

    // **No platform-admin bypass** (PLT-01). It used to read "platform admins
    // can do anything", which meant whoever runs MaybeOS could read, edit and
    // delete inside any co-op on it — every member list, every DM, every
    // financial record — silently and with nothing recorded.
    //
    // Charley's rule is that member PII stays private, and a bypass on the
    // guard that keeps one co-op's roster from another is the opposite of
    // that. A platform admin reaches a co-op's data the way anybody does: by
    // being invited into it. What they get instead is a console of their own
    // (`/platform`), which answers about co-ops rather than about members.
    //
    // Safe to remove because **production has never had a platform admin** —
    // this is a power being defined before it is handed out, not one being
    // taken away from somebody using it.

    const userRole = user.orgRoles[orgId];
    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
