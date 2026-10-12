import {
  CallHandler,
  ForbiddenException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
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
 * Applied globally rather than as a decorator each controller opts into,
 * because the failure mode of opt-in is silent and permanent: somebody adds
 * an endpoint next year, forgets the decorator, and a co-op's house rules
 * quietly stop applying to whatever that endpoint does. Default-on means a
 * new route is covered before anyone has thought about it, and the only way
 * out is an explicit `@BypassRequiredReading` with a written reason.
 *
 * **An interceptor rather than a guard, and that is not a style choice.**
 * Nest runs *global* guards before controller-scoped ones, so a global guard
 * here ran before `JwtAuthGuard` had put anything on `request.user` — it saw
 * an unauthenticated request every single time and waved all of them through.
 * The gate was inert, and inert in the way that looks fine: no error, no log,
 * a co-op believing its rules were being enforced. Interceptors run *after*
 * every guard, so the member is known by the time this asks who they are.
 *
 * Unit tests could not catch that, because they hand this a context with a
 * user already on it. What caught it was posting a message in a browser and
 * watching it succeed.
 *
 * **Reading is never gated.** The point is that people can see what they are
 * joining before they agree to it — a co-op that hid its own norms behind
 * agreement to those norms would be asking for a signature on a blank page.
 */
@Injectable()
export class RequiredReadingInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    await this.assertNothingOutstanding(context);
    return next.handle();
  }

  private async assertNothingOutstanding(context: ExecutionContext): Promise<void> {
    if (context.getType() !== 'http') return;

    const request = context.switchToHttp().getRequest();
    if (!WRITE_METHODS.has(request.method)) return;

    const bypass = this.reflector.getAllAndOverride<string>(BYPASS_REQUIRED_READING, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (bypass) return;

    // No user means an unauthenticated route, which has its own protection
    // and no member to owe anything. No orgId means a route outside a co-op —
    // signing up, signing in — which cannot be gated by a co-op's articles.
    const userId = request.user?.userId;
    const orgId = request.params?.orgId;
    if (!userId || !orgId) return;

    const settings = await this.prisma.belongingSettings.findUnique({
      where: { orgId },
      select: { knowledgeCenterEnabled: true, requiredReadingGraceDays: true },
    });
    // Off means off (§8.10): no gate, and historical acknowledgments are left
    // exactly where they are.
    if (!settings?.knowledgeCenterEnabled) return;

    const membership = await this.prisma.userOrg.findFirst({
      where: { orgId, userId },
      select: { id: true, memberSince: true },
    });
    if (!membership) return;

    const articles = await this.prisma.knowledgeArticle.findMany({
      where: { orgId, state: 'PUBLISHED', requiresAcknowledgment: true },
      orderBy: { position: 'asc' },
      select: { id: true, title: true, slug: true, version: true, requiredSince: true },
    });
    if (articles.length === 0) return;

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

    /*
      Recorded, not refused (BEL-07).

      This threw a 403 on every write while anything was outstanding, which
      made the gate land on whatever the member happened to be doing — and
      what they were usually doing was the thing they joined to do. Charley:
      "make this really easy for them by just reminding them… Allow them to
      proceed with their booking or reservation. After 30 days, force them to
      the Handbook after login."

      So the consequence moved from the action to the door. A member past
      their window meets the handbook when they arrive, rather than a refusal
      three clicks later with a booking half-filled in.

      It was also catching far more people than anyone realised: MaybeItsFate
      made two articles required on 4 September, every migrated member's
      window closed on 4 October, and 402 of its 439 members were refused
      every write from that morning on. Nobody reported it as an outage
      because each person met it once, alone, as a sentence about the
      handbook.

      Both figures travel on the request, so a response can carry the
      countdown and the shell can send somebody to the handbook.
    */
    request.requiredReadingGraceEndsAt = graceEndsAt(outstanding);
    request.requiredReadingBlocking = outstanding.blocking.map((a) => ({
      id: a.id,
      title: a.title,
      slug: a.slug,
    }));

    if (outstanding.blocking.length === 0) return;

    /*
      And past the window, it still refuses — as a backstop, not as the
      experience (BEL-08).

      BEL-07 took this out so the rule would stop landing on whatever a
      member happened to be doing. That was right about the moment and wrong
      about the mechanism: it left the acknowledgment enforced only by the
      app sending people to the handbook, so the record stopped describing
      everybody taking part and started describing everybody whose browser
      had been through the shell recently.

      37 members have formally agreed to this co-op's Code of Conduct. The
      worth of that record is that it covers the people acting here.

      Almost nobody should ever see this: `RequiredReadingGate` sends them to
      the handbook when they arrive, long before they fill in a form. If it
      starts appearing often, the gate is broken rather than this being
      useful.

      Agreeing is exempt (`@BypassRequiredReading` on the acknowledge route),
      so anybody refused here is one click from undoing it.
    */
    const next = outstanding.blocking[0];
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
