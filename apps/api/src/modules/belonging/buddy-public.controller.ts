import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { BuddyService } from './buddy.service';

/**
 * Accepting or declining a buddy invitation, from a link in an email
 * (PRD §5.1).
 *
 * **Unauthenticated by design**, and the only Belonging Support route that
 * is. Somebody being asked to welcome a new member should be able to say yes
 * from their phone without first remembering a password — a login wall
 * between the ask and the answer is a login wall between a new member and
 * their first friend here.
 *
 * The token is the authorisation: 32 random bytes, single use, stored only as
 * a hash. A token that no longer matches a pending invitation gets a friendly
 * "this one is already covered" rather than an error, because a member
 * clicking a stale link did nothing wrong.
 */
@ApiTags('belonging')
@Controller('buddy')
export class BuddyPublicController {
  constructor(private readonly buddies: BuddyService) {}

  @Get(':token')
  // Throttled by IP would punish a co-op behind one office NAT, and the
  // token itself is the rate limit: guessing one is guessing 256 bits.
  @SkipThrottle()
  @ApiOperation({ summary: 'Answer a buddy invitation' })
  respond(@Param('token') token: string, @Query('answer') answer?: string) {
    return this.buddies.respond(token, answer === 'decline' ? 'decline' : 'accept');
  }
}
