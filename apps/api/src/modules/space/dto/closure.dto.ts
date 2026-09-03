import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * A period a room is shut (SPC-18).
 *
 * Dates arrive as local calendar dates, not instants. "Closed on the 25th"
 * means the 25th where the room is, and the co-op's timezone is the server's
 * to apply — a browser in another city sending its own midnight would close
 * the room on the wrong day.
 */
export class ClosureDto {
  @ApiProperty({ example: '2026-12-24', description: 'First day closed, in the co-op’s timezone' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fromDate must look like YYYY-MM-DD' })
  fromDate: string;

  @ApiPropertyOptional({
    example: '2027-01-02',
    description: 'Last day closed, inclusive. Omitted means a single day.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'toDate must look like YYYY-MM-DD' })
  toDate?: string;

  @ApiPropertyOptional({
    example: '13:00',
    description: 'Closed from this time each day. Omitted means all day.',
  })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'startTime must look like HH:mm' })
  startTime?: string;

  @ApiPropertyOptional({ example: '17:00' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'endTime must look like HH:mm' })
  endTime?: string;

  @ApiPropertyOptional({ example: 'Winter break' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
