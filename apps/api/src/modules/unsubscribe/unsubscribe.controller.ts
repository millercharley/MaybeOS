import { Controller, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { decodeUnsubscribe } from '../../common/unsubscribe-token';
import { RadarService } from '../radar/radar.service';
import { CommonsDigestService } from '../commons/commons-digest.service';
import { AnnouncementService } from '../commons/announcement.service';
import { RecapService } from '../recap/recap.service';

/**
 * Stopping an email MaybeOS sends, from the link in it (RDR-01, RCP-01).
 *
 * **One route for every kind**, because a member who wants an email to stop
 * should not have to care which feature sent it, and because an unsubscribe
 * that works for one email and not another is the kind of thing nobody
 * notices until somebody is angry. The signed token names what it switches
 * off; this dispatches on that and nothing else.
 *
 * **Its own file and its own module.** The audit at
 * `org/__tests__/unauthenticated-routes.spec.ts` reads the first controller
 * class in each file, so a public controller beside another is invisible to
 * it — found on 2026-09-16 when `MetaCallbackController` slipped past.
 *
 * **Unauthenticated by design.** A login wall in front of an unsubscribe is
 * how an unsubscribe becomes a spam complaint. The token is the
 * authorisation, and it authorises exactly one thing: setting one switch to
 * false on the membership it names.
 *
 * **POST, not GET.** Mail clients, link scanners and corporate security
 * products follow links in email, and a GET that unsubscribed would let a
 * scanner silently switch a member off. The page the link opens makes the
 * call when the member actually asks it to.
 */
@ApiTags('radar')
@Controller('radar')
export class UnsubscribeController {
  constructor(
    private readonly radar: RadarService,
    private readonly recap: RecapService,
    private readonly commonsDigest: CommonsDigestService,
    private readonly announcements: AnnouncementService,
    private readonly config: ConfigService,
  ) {}

  @Post('unsubscribe')
  // The token is the rate limit: forging one is forging an HMAC. Throttling
  // by IP would instead punish a co-op whose members share an office.
  @SkipThrottle()
  @ApiOperation({ summary: 'Stop an email MaybeOS sends, using the token from one' })
  async unsubscribe(@Query('token') token?: string) {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const decoded = decodeUnsubscribe(token, secret);

    // One answer for a bad token and for a membership that no longer exists.
    // Anything more tells whoever is holding a guessed token whether they
    // guessed a real one.
    if (!decoded) return { ok: false };

    /*
      Switched on explicitly, with no fall-through (CMN-20).

      This was a ternary ending in `: radar`, which was correct while there
      were two purposes and silently wrong the moment there were three: a
      member stopping the Commons digest would have had their Radar digest
      stopped instead, and been told so. Somebody who asks to stop one email
      and loses another is owed better than a default branch.
    */
    const stop: Record<typeof decoded.purpose, () => Promise<{ orgName: string } | null>> = {
      radar: () => this.radar.unsubscribeByToken(decoded.userOrgId),
      recap: () => this.recap.unsubscribeByToken(decoded.userOrgId),
      commons: () => this.commonsDigest.unsubscribeByToken(decoded.userOrgId),
      announcement: () => this.announcements.unsubscribeByToken(decoded.userOrgId),
    };

    const result = await stop[decoded.purpose]();

    return result ? { ok: true, orgName: result.orgName, purpose: decoded.purpose } : { ok: false };
  }
}
