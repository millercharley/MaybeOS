import { Controller, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { decodeUnsubscribe } from '../../common/unsubscribe-token';
import { RadarService } from './radar.service';

/**
 * Unsubscribing from Radar email, from the link in the email (RDR-01).
 *
 * **Its own file, deliberately.** The audit at
 * `org/__tests__/unauthenticated-routes.spec.ts` reads the first controller
 * class in each file, so a second class beside another one is invisible to
 * it — found on 2026-09-16 when `MetaCallbackController` slipped past. Until
 * that scanner walks every class, a public controller lives alone.
 *
 * **Unauthenticated by design.** Somebody who wants the email to stop should
 * not have to remember a password first; a login wall in front of an
 * unsubscribe is how an unsubscribe becomes a spam complaint. The signed
 * token is the authorisation, and it authorises exactly one thing: setting
 * `radarEmails` to false on the membership it names.
 *
 * **POST, not GET.** Mail clients, link scanners and corporate security
 * products follow links in email, and a GET that unsubscribes would let a
 * scanner silently switch a member off. The page the link opens makes the
 * call when the member actually asks it to.
 */
@ApiTags('radar')
@Controller('radar')
export class RadarUnsubscribeController {
  constructor(
    private readonly radar: RadarService,
    private readonly config: ConfigService,
  ) {}

  @Post('unsubscribe')
  // The token is the rate limit: forging one is forging an HMAC. Throttling
  // by IP would instead punish a co-op whose members share an office.
  @SkipThrottle()
  @ApiOperation({ summary: 'Stop Radar emails, using the token from one of them' })
  async unsubscribe(@Query('token') token?: string) {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    const decoded = decodeUnsubscribe(token, secret);

    // One answer for a bad token and for a membership that no longer exists.
    // Anything more tells whoever is holding a guessed token whether they
    // guessed a real one.
    if (!decoded) return { ok: false };

    const result = await this.radar.unsubscribeByToken(decoded.userOrgId);
    return result ? { ok: true, orgName: result.orgName } : { ok: false };
  }
}
