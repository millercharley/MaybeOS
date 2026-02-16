import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsInt,
  IsString,
  IsBoolean,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export class AvailabilityRuleDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Day of week: 0=Sunday .. 6=Saturday. Null applies to all days.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @ApiProperty({ example: '09:00', description: 'Start time in HH:mm format' })
  @IsString()
  startTime: string;

  @ApiProperty({ example: '17:00', description: 'End time in HH:mm format' })
  @IsString()
  endTime: string;

  @ApiPropertyOptional({ example: 15, description: 'Buffer minutes between bookings' })
  @IsOptional()
  @IsInt()
  @Min(0)
  bufferMinutes?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'If true, this rule blocks bookings instead of allowing them',
  })
  @IsOptional()
  @IsBoolean()
  isBlackout?: boolean;

  @ApiPropertyOptional({ example: '2026-03-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.000Z' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}
