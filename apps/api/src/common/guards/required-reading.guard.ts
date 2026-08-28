import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../config/prisma.service';
import { BYPASS_REQUIRED_READING } from '../decorators/bypass-required-reading.decorator';
import {
  outstandingReading,
  graceEndsAt,
} from '../../modules/belonging/required-reading';

/** The methods that change something. Reading stays open, always. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * One server-side check, in one place, covering every write endpoint
 * (PRD §6.2, §8.8).
 *
 * A global guard rather than a decorator each controller opts into, because
 * the failure mode of opt-in is silent and permanent: somebody adds an
 * endpoint next year, forgets the decorator, and a co-op's house rules
 * quietly stop applying to whatever that endpoint does. Default-on means a
 * new route is covered before anyone has thought about it, and the only way
 * out is an explicit `@BypassRequiredReading` with a written reason.
 *
 * **Reading is never gated.** The point is that people can see what they are
 * joining before they agree to it — a co-op that hid its own norms behind
 * agreement to those norms would be asking for a signature on a blank page.
 */
@Injectable()
export class RequiredReadingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    if (!WRITE_METHODS.has(request.method)) return true;

    const bypass = this.reflector.getAllAndOverride<string>(BYPASS_REQUIRED_READING, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) return true;

    // No user means an unauthenticated route, which has its own protection
    // and no member to owe anything. No orgId means a route outside a co-op —
    // signing up, signing in — which cannot be gated by a co-op's articles.
    const userId = request.user?.userId;
    const orgId = request.params?.orgId;
    if (!userId || !orgId) return true;

    const settings = await this.prisma.belongingSettings.findUnique({
      where: { orgId },
      select: { knowledgeCenterEnabled: true, requiredReadingGraceDays: true },
    });
    // Off means off (§8.10): no gate, and historical acknowledgments are left
    // exactly where they are.
    if (!settings?.knowledgeCenterEnabled) return true;

    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true, memberSince: true },
    });
    if (!membership) return true;

    const articles = await this.prisma.knowledgeArticle.findMany({
      where: { orgId, state: 'PUBLISHED', requiresAcknowledgment: true },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, slug: true, version: true, requiredSince: true },
    });
    if (articles.length === 0) return true;

    const acknowledgments = await this.prisma.articleAcknowledgment.findMany({
      where: { memberId: membership.id, articleId: { in: articles.map((a) => a.id) } },
      select: { articleId: true, articleVersion: true },
    });

    const acknowledgedVersions = new Map<string, number>();
    for (const ack of acknowledgments) {
      // Highest version wins, so an old acknowledgment cannot mask a newer one.
      const seen = acknowledgedVersions.get(ack.articleId) ?? 0;
      if (ack.articleVersion > seen) acknowledgedVersions.set(ack.articleId, ack.articleVersion);
    }

    const outstanding = outstandingReading(
      articles,
      { memberSince: membership.memberSince, acknowledgedVersions },
      settings.requiredReadingGraceDays,
      new Date(),
    );

    if (outstanding.blocking.length === 0) {
      // Attached so a response can carry the countdown banner without every
      // controller having to ask for it.
      request.requiredReadingGraceEndsAt = graceEndsAt(outstanding);
      return true;
    }

    const next = outstanding.blocking[0];
    // A clear message and a link to the article, never a generic error
    // (§6.2). Somebody who cannot post should learn what to do about it in
    // the same breath.
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      reason: 'REQUIRED_READING',
      message:
        outstanding.blocking.length === 1
          ? `Before you can take part here, this community asks you to read and agree to “${next.title}”.`
          : `Before you can take part here, this community asks you to read and agree to ${outstanding.blocking.length} things, starting with “${next.title}”.`,
      articles: outstanding.blocking.map((a) => ({ id: a.id, title: a.title, slug: a.slug })),
    });
  }
}
