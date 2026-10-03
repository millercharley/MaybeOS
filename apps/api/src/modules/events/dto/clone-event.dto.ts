import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional } from 'class-validator';

/**
 * Copying an event to a new date (EVT-38).
 *
 * Distinct from repeating it. A repeat is a rule somebody set once; a clone
 * is "do that again", and the thing being copied is often a one-off — last
 * year's fundraiser, the workshop that went well.
 *
 * In its own file: `unauthenticated-routes.spec.ts` reads only the first
 * class in a controller file.
 */
export class CloneEventDto {
  @ApiProperty({ example: '2027-02-14T19:00:00.000Z' })
  @IsDateString()
  startTime!: string;

  /**
   * Hold the same rooms for the copy (EVT-38).
   *
   * The copy's rooms are offered at the same offsets from its start. A date
   * where the room is taken is reported rather than booked.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  withRooms?: boolean;

  /**
   * What to copy, when the event is one of a series (EVT-38).
   *
   * Charley asked for a "double opt-in" here, and it is the right shape: a
   * member looking at one Tuesday of a weekly class has no way of knowing
   * from the screen whether "clone" means that Tuesday or all fifty-two.
   * Required when the event has a series, so nobody can mean it by accident;
   * absent is fine for a one-off, where there is nothing to be confused about.
   */
  @ApiPropertyOptional({ enum: ['one', 'series'] })
  @IsOptional()
  @IsIn(['one', 'series'])
  scope?: 'one' | 'series';

  /**
   * The second half of that opt-in: having chosen, say so again.
   *
   * Only required for `series`, which is the choice that writes dozens of
   * rows. Choosing "one" twice would be asking somebody to confirm a thing
   * they can undo by deleting a single draft.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  confirmSeries?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
