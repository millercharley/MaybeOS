import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Somebody who turned up without an RSVP.
 *
 * The name is optional on purpose: at a door, "one more person came in" is
 * worth recording even when nobody stops to ask who. Requiring a name would
 * lose exactly the counts reach indicators exist to capture (IMP-10).
 */
export class WalkInDto {
  @ApiPropertyOptional({ example: 'Sam from the allotment' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
