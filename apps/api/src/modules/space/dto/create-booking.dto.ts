import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsIn,
  IsInt,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

/**
 * The three answers a booking gives about who it is for. Reuses the event
 * vocabulary rather than inventing a second one — a booking published as an
 * event (EVT-05) has to answer the same question.
 */
export const BOOKING_VISIBILITY = ['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE'] as const;

export class CreateBookingDto {
  @ApiProperty({ example: 'Team Standup' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Daily standup meeting for engineering team' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Everything below is asked when the booking is made (SPC-21) and shown on
   * the room's Google Calendar, which is where a co-op actually looks — and
   * often the only place someone not in MaybeOS looks at all.
   *
   * All optional: a booking that answers none of them still works, and every
   * booking made before this existed answered none.
   */
  @ApiPropertyOptional({ enum: BOOKING_VISIBILITY, default: 'PRIVATE' })
  @IsOptional()
  @IsIn(BOOKING_VISIBILITY as unknown as string[])
  visibility?: (typeof BOOKING_VISIBILITY)[number];

  @ApiPropertyOptional({ example: 15, description: 'Roughly how many people' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  expectedAttendance?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the member charges their attendees — not the room hire fee',
  })
  @IsOptional()
  @IsBoolean()
  hasCost?: boolean;

  @ApiPropertyOptional({ example: ['Art or expression', 'Organising'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  categories?: string[];

  @ApiProperty({ example: '2026-03-01T09:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-03-01T10:00:00.000Z' })
  @IsDateString()
  endTime: string;
}
