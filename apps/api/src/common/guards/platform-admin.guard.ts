import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequestUser } from '../decorators/current-user.decorator';

/**
 * The only thing `PLATFORM_ADMIN` now grants (PLT-01).
 *
 * Until 2026-08-20 the role was a bypass on every org-scoped guard in the
 * product — whoever ran MaybeOS could read, edit and delete inside any co-op
 * on it. Those bypasses are gone. This guard is what replaced them: it opens
 * the platform console and nothing else, and the console answers about
 * **co-ops**, never about their members.
 *
 * Nothing anywhere grants this role. **A role that can grant itself is not a
 * role** — a console that could promote its own operator would make the
 * distinction it enforces decorative. It is set outside the product, by
 * somebody with database access, deliberately.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;

    if (!user || user.globalRole !== 'PLATFORM_ADMIN') {
      // Forbidden rather than NotFound, unlike the tenant-scoping rule: there
      // is nothing to hide here. The console's existence is not a secret, and
      // a 404 would only make a misconfigured admin account harder to debug.
      throw new ForbiddenException('Platform administrators only');
    }

    return true;
  }
}
