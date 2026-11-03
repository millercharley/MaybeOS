import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Somebody who may manage a room reservation (SPC-37).
 *
 * The same shape as `EventHostDto`, and for the same reason: a member id, and
 * the service decides whether the caller may say so.
 */
export class BookingCoHostDto {
  @ApiProperty({ description: 'The member being added. Must belong to the co-op.' })
  @IsUUID()
  userId: string;
}
