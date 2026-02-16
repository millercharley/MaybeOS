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

    // Platform admins can do anything
    if (user.globalRole === 'PLATFORM_ADMIN') {
      return true;
    }

    const userRole = user.orgRoles[orgId];
    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
