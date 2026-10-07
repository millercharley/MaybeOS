import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RESEND_SCOPES, type ResendScope } from '../sign-in-audit';

/**
 * Sending a roster its way in (MEM-18).
 *
 * In its own file, like every other DTO beside a controller: the
 * unauthenticated-route audit reads the first class in a controller file, and
 * a DTO declared above the controller is that first class.
 */
export class SendSignInLinksDto {
  /** How many to send now. Capped by the service, because a roster goes out in batches. */
  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /**
   * List who would be sent to without sending anything.
   *
   * The habit the Stripe adoption scan established: look at the list of real
   * people before writing to all of them.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * Which group to write to (MEM-24).
   *
   * `waiting` is the original migration send and the default, so an older
   * client keeps the behaviour it had. `undelivered` reaches the people the
   * audit found Postmark never accepted a message for — the ones a capped plan
   * swallowed. `not-signed-in` nudges the people who got their link and have
   * not used it.
   *
   * Bounced addresses are in none of them: see `scopeFilter`.
   */
  @ApiPropertyOptional({ enum: RESEND_SCOPES, example: 'undelivered' })
  @IsOptional()
  @IsIn(RESEND_SCOPES)
  scope?: ResendScope;
}
