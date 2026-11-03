import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Handing a batch of events to a new host (EVT-47).
 *
 * Events are named by id, not by title, even though the title is how they are
 * grouped on the way in. The admin approved a list they were shown; sending
 * the title instead would re-run the search at write time and could move
 * something created in between.
 */
export class TransferEventsDto {
  @ApiProperty({ description: 'Whose events these are. Checked against every id sent.' })
  @IsUUID()
  fromUserId: string;

  @ApiProperty({ description: 'The member taking them on. Must belong to the co-op.' })
  @IsUUID()
  toUserId: string;

  /**
   * Capped well above the biggest series MaybeItsFate has (46) and below its
   * whole backlog (769): a request that means to move everything somebody
   * owns in one go is worth making deliberately, a page at a time, with a
   * count to read in between.
   */
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  eventIds: string[];

  @ApiPropertyOptional({
    default: false,
    description:
      'Report what would happen and write nothing. Every bulk action here offers this.',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
