import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SelectEventsCalendarDto {
  /** Null clears it, which stops the import producing events at all. */
  @ApiPropertyOptional({ example: 'maybeitsfate.com_abc123@group.calendar.google.com' })
  @IsOptional()
  @IsString()
  calendarId?: string | null;
}

export class RunCalendarImportDto {
  /** Defaults to true in the service: look at the list before writing to it. */
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ example: 12 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  monthsBack?: number;
}
