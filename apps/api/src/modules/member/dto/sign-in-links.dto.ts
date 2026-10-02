import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

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
}
