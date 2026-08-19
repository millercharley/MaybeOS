import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One row of somebody else's export, after the browser has mapped its columns.
 *
 * Deliberately not shaped like any one platform's CSV. The web importer does
 * the mapping — a header called "Join Date", "Member since" or "created_at" is
 * the same field — so the API only ever sees MaybeOS's own names and never
 * grows a special case for whichever community tool a co-op is leaving.
 */
export class ImportMemberRowDto {
  @ApiProperty({ example: 'member@example.org' })
  @IsEmail({}, { message: 'Not an email address' })
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /**
   * When they joined the co-op, not when this import ran. A community that
   * has existed for three years and imports as though everyone arrived on
   * Tuesday has lost the one fact its members would notice.
   */
  @ApiPropertyOptional({ example: '2023-09-22T18:45:04.000Z' })
  @IsOptional()
  @IsISO8601()
  joinedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  bio?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  /**
   * Website and social profiles collapse into one list, because that is what
   * MEM-09 already built and a member with two Instagram accounts is not a
   * schema problem. Non-http links are dropped on the way in.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  links?: string[];

  /** Where the avatar lives *now*. Copied into MaybeOS as a second step. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  avatarUrl?: string;

  /** True opted in, false opted out, absent never asked. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailOptIn?: boolean;
}

export class ImportMembersDto {
  /**
   * Capped at 100 because this runs in a Lambda with a wall clock, and a
   * co-op with 3,000 members should not discover the ceiling as a timeout
   * halfway through its roster. The importer sends chunks and can resume.
   */
  @ApiProperty({ type: [ImportMemberRowDto] })
  @IsArray()
  @ArrayMaxSize(100, { message: 'Import at most 100 rows per request' })
  @ValidateNested({ each: true })
  @Type(() => ImportMemberRowDto)
  rows!: ImportMemberRowDto[];
}

/**
 * One pass of avatar copying.
 *
 * A cursor rather than a "find the unfinished ones" query, so a member whose
 * avatar cannot be fetched is passed over once instead of being retried
 * forever by a client that keeps asking for the outstanding batch.
 */
export class ImportAvatarsDto {
  @ApiPropertyOptional({ description: 'Continue after this membership id' })
  @IsOptional()
  @IsUUID()
  after?: string;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(15)
  limit?: number;
}
