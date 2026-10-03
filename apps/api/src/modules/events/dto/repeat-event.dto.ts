import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

/**
 * Repeating an event, or copying one forward (EVT-37).
 *
 * In its own file: `unauthenticated-routes.spec.ts` reads only the first
 * class in a controller file, so a DTO sharing one can hide a route.
 */
export class RepeatEventDto {
  @ApiProperty({ enum: ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] })
  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'])
  frequency!: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

  @ApiPropertyOptional({ example: 1, minimum: 1, maximum: 52 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(52)
  interval?: number;

  /** 0 = Sunday, the way Google numbers them. */
  @ApiPropertyOptional({ example: [2, 4] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];

  @ApiPropertyOptional({ example: 12, minimum: 1, maximum: 200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  count?: number;

  @ApiPropertyOptional({ example: '2027-06-30T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  until?: string;

  /**
   * Hold the same room for each one (EVT-37).
   *
   * The reason this is harder than a calendar's repeat: a room is exclusive.
   * Every date is checked against what the building already has, and the ones
   * that clash are reported rather than booked — an organiser needs to know
   * that the 14th is taken, not to find out in November.
   */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  withRooms?: boolean;

  /**
   * Carry on from this occurrence (EVT-38).
   *
   * A year of a daily event is 366 events and 366 reservations, which does
   * not fit in one request — the calendar import learned the same thing the
   * expensive way (CAL-05). The reply says where it stopped and the client
   * asks again.
   */
  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 400 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  fromIndex?: number;

  /** Say what would happen without writing anything. */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}
