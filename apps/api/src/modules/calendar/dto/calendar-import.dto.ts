import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  MaxLength,
  ValidateIf,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** How far a previous request got (CAL-05). */
export class ImportCursorDto {
  @ApiPropertyOptional({ example: 0 })
  @IsInt()
  @Min(0)
  @Max(500)
  calendar!: number;

  /**
   * Google's own page token for the page being read (CAL-06).
   *
   * This is handed straight back to Google rather than interpreted here, so
   * it is bounded and nothing more: a token is opaque, and a validator that
   * pretended to understand its shape would reject a valid one the first
   * time Google changed it.
   *
   * It was missing from this DTO when the cursor gained it, and the
   * whitelist did exactly what it is for — "resumeFrom.property page should
   * not exist", which stopped the import on its second request.
   */
  @ApiPropertyOptional({ example: 'CiAKGjBpNDd2Nmp2Zml2cXRwYjBpOXA' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(2048)
  page?: string | null;

  @ApiPropertyOptional({ example: 150 })
  @IsInt()
  @Min(0)
  @Max(100000)
  entry!: number;
}

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

  /**
   * Where the previous request stopped (CAL-05).
   *
   * Nine calendars and a year of entries do not fit in a Lambda's wall clock
   * — MaybeItsFate's first real import returned 504 — so a run stops when it
   * is nearly out of time and reports where it got to. The client sends that
   * back, and keeps going until the reply carries no cursor.
   *
   * Bounded rather than trusted: both numbers index into a list the server
   * builds, and a vast one would make the server read a calendar to slice
   * nothing out of it.
   */
  @ApiPropertyOptional({ example: { calendar: 0, entry: 150 } })
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportCursorDto)
  resumeFrom?: ImportCursorDto;
}
