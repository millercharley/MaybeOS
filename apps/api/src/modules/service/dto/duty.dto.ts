import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsIn,
  Min,
  Max,
  MaxLength,
  Matches,
} from 'class-validator';

const RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

/**
 * Naming something that needs doing (SRV-01).
 *
 * Every field the form sends must appear here. The API validates against a
 * whitelist with `forbidNonWhitelisted`, so a field the DTO does not know
 * refuses the whole save rather than ignoring the one value — the lesson from
 * SPC-10, where a new room field broke every existing room's edit screen.
 */
export class CreateDutyDto {
  @ApiProperty({ example: 'Take the bins out' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Blue bin to the kerb by 8am Wednesday.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 30, description: 'What one turn takes, in minutes.' })
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  estimatedMinutes: number;

  @ApiPropertyOptional({ example: 1, description: 'How many people one turn needs.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  capacity?: number;

  @ApiPropertyOptional({ description: 'Whether an organiser has to say yes.' })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ enum: RECURRENCES })
  @IsOptional()
  @IsIn(RECURRENCES as unknown as string[])
  recurrence?: string;

  @ApiProperty({ example: '2026-09-08', description: 'First occurrence, local date.' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startsOn must look like YYYY-MM-DD' })
  startsOn: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endsOn must look like YYYY-MM-DD' })
  endsOn?: string;

  @ApiPropertyOptional({ example: '08:00', description: "Local clock time, 'HH:MM'." })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must look like HH:MM' })
  startTime?: string;
}

export class UpdateDutyDto extends PartialType(CreateDutyDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
