import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
  Matches,
} from 'class-validator';

/**
 * Taking one turn, or several (SRV-01).
 *
 * An array rather than a single date, because Charley's answer to how a
 * recurring duty is claimed was "pick specific dates to claim" — three
 * Tuesdays in one gesture, not three requests.
 */
export class ClaimDutyDto {
  @ApiProperty({ example: ['2026-09-08', '2026-09-15'], type: [String] })
  @IsArray()
  @ArrayMaxSize(60)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    each: true,
    message: 'dates must look like YYYY-MM-DD',
  })
  dates: string[];
}

export class CompleteClaimDto {
  @ApiPropertyOptional({
    example: 45,
    description: "What it actually took. Defaults to the duty's estimate.",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  minutes?: number;

  @ApiPropertyOptional({ example: 'The bin store was locked and I had to find a key.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
