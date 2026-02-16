import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateBookingDto {
  @ApiProperty({ example: 'Team Standup' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Daily standup meeting for engineering team' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: '2026-03-01T09:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-03-01T10:00:00.000Z' })
  @IsDateString()
  endTime: string;
}
