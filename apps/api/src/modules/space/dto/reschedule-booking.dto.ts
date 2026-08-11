import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class RescheduleBookingDto {
  @ApiProperty({ example: '2026-08-12T14:00:00.000Z' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: '2026-08-12T16:00:00.000Z' })
  @IsDateString()
  endTime: string;
}
