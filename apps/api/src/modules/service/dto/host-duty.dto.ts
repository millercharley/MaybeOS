import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsBoolean,
  IsUUID,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';

export const PHASES = ['BEFORE', 'DURING', 'AFTER'] as const;
export const ANCHORS = [
  'CLOCK_ON_DAY',
  'BEFORE_START',
  'AFTER_START',
  'BEFORE_END',
  'AFTER_END',
] as const;

/**
 * One thing a host has to do around their booking (SRV-03).
 *
 * Every field a form sends must appear here: the API validates against a
 * whitelist with `forbidNonWhitelisted`, so a field the DTO does not know
 * refuses the whole save rather than ignoring one value (the SPC-10 lesson).
 */
export class HostDutyDto {
  @ApiProperty({ enum: PHASES })
  @IsIn(PHASES as unknown as string[])
  phase: string;

  @ApiProperty({ example: 'Prop the side door and put the sign out on the pavement.' })
  @IsString()
  @MaxLength(500)
  text: string;

  @ApiPropertyOptional({
    description: 'Scopes this to one room. Omit for every room.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  roomId?: string | null;
}

/** The message for one phase, and when it goes out. */
export class HostBriefingDto {
  @ApiProperty({ example: 'You have the Attic today' })
  @IsString()
  @MaxLength(200)
  subject: string;

  @ApiProperty({ example: 'A few things before you open up.' })
  @IsString()
  @MaxLength(5000)
  body: string;

  @ApiPropertyOptional({ enum: ANCHORS, default: 'CLOCK_ON_DAY' })
  @IsOptional()
  @IsIn(ANCHORS as unknown as string[])
  anchor?: string;

  @ApiPropertyOptional({ example: '07:00', description: 'For CLOCK_ON_DAY.' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'clockTime must look like HH:MM' })
  clockTime?: string;

  @ApiPropertyOptional({ example: 60, description: 'Minutes, for every other anchor.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  // A week either side. Beyond that the message is not about the booking.
  @Max(7 * 24 * 60)
  offsetMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
