import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { RequestUser } from '../decorators/current-user.decorator';
import { PrismaService } from '../../config/prisma.service';

/**
 * Baseline tenant-isolation check for any route with an :orgId param: the
 * authenticated caller must actually belong to that org (any role).
 * RolesGuard only checks *specific* roles, and only when a route opts in via
 * @Roles(...) — routes with no @Roles() decorator at all skip that check
 * entirely. This guard closes that gap by enforcing plain membership
 * unconditionally, independent of @Roles().
 *
 * It is also where a **suspended** co-op stops (PLT-01). One indexed
 * primary-key lookup per org-scoped request, which is a real cost paid on
 * every request in the product — and the alternative is a suspension that
 * only takes effect at next sign-in, which is not a suspension.
 */
@Injectable()
export class OrgMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    // No platform-admin bypass here either (PLT-01) — see `roles.guard.ts`.
    // Membership is the thing this guard exists to check, and a role that
    // skips it is not a member.

    if (!user.orgRoles?.[orgId]) {
      throw new ForbiddenException('Not a member of this organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { suspendedAt: true, suspendedReason: true },
    });

    if (org?.suspendedAt) {
      // The reason is included on purpose. An organiser locked out of their
      // own membership list with an unexplained 403 has nothing to act on,
      // and the same sentence is in their audit log.
      throw new ForbiddenException(
        `This co-op is suspended: ${org.suspendedReason ?? 'contact MaybeOS'}`,
      );
    }

    return true;
  }
}
