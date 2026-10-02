import { IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MANUAL_STATUSES } from '../manual-status';

/**
 * A status an organiser sets by hand (MEM-23).
 *
 * In its own file: `unauthenticated-routes.spec.ts` reads only the first
 * class in a controller file, so a DTO sharing a file with a controller can
 * hide a route from the audit.
 */
export class SetMemberStatusDto {
  @ApiProperty({ enum: MANUAL_STATUSES, example: 'ACTIVE' })
  @IsString()
  @IsIn(MANUAL_STATUSES as unknown as string[], {
    message: `Status must be one of ${MANUAL_STATUSES.join(', ')}`,
  })
  status!: string;
}
