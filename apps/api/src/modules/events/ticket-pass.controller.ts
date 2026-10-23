import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { TicketPassService } from './ticket-pass.service';

/**
 * A ticket buyer's proof that they paid (EVT-46).
 *
 * **Its own file**, for the reason the unsubscribe controller gives: the audit
 * at `org/__tests__/unauthenticated-routes.spec.ts` reads only the first
 * controller class in each file, so a public controller sitting beside another
 * is invisible to it. That is how `MetaCallbackController` slipped past.
 *
 * **Unauthenticated by design.** The people this serves are not members and
 * have no account — they bought a ticket to a public show. A sign-in wall in
 * front of a door pass is a queue at the door.
 *
 * **GET, unlike the unsubscribe POST.** That one is POST because a link
 * scanner following a link must not switch somebody's email off; this one
 * only reads, so a scanner following it changes nothing and the buyer gets a
 * page that works the moment they tap it.
 *
 * The token is an HMAC over the event and the buyer's address, and it
 * authorises exactly one thing: seeing how many seats that address holds for
 * that event. It is never a session and must never grow into one.
 */
@ApiTags('events')
@Controller('tickets')
export class TicketPassController {
  constructor(private readonly passes: TicketPassService) {}

  @Get('pass')
  // The token is the rate limit: forging one is forging an HMAC. Throttling by
  // IP would punish a theatre lobby, where forty people on one wifi open their
  // passes inside a minute — which is the exact moment this must not fail.
  @SkipThrottle()
  @ApiOperation({ summary: "A ticket buyer's pass, from the link in their confirmation" })
  async pass(@Query('token') token?: string) {
    const pass = await this.passes.viewPass(token);

    // One answer for a forged token, a deleted event and a refunded buyer.
    // Anything more tells whoever is holding a guessed token whether they
    // guessed a real sale.
    return pass ?? { ok: false as const };
  }
}
