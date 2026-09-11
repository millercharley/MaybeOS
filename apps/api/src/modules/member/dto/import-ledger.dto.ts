import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const MAX_SHARES = 2_000_000_000;

/**
 * One row of the co-op's cap table, after the browser has found its columns
 * (MEM-17). Email is a plain string rather than `@IsEmail`: one malformed
 * address in a 500-row sheet would otherwise reject the whole import, and the
 * server already treats a row without a usable address as unimportable and
 * says so by name.
 */
export class CapTableRowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_SHARES) annual?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_SHARES) founder?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_SHARES) believer?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_SHARES) bounty?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_SHARES) referral?: number;
  @ApiProperty() @IsInt() @Min(0) @Max(MAX_SHARES) totalShares!: number;
}

export class ImportLedgerDto {
  @ApiProperty({ type: [CapTableRowDto] })
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => CapTableRowDto)
  rows!: CapTableRowDto[];

  /** The sheet's own totals row, to check the import against. */
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) sheetTotal?: number;

  /** Defaults to true: a caller that forgets gets the preview. */
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() dryRun?: boolean;

  /** Publish even though the import disagrees with the sheet's total. */
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptMismatch?: boolean;
}
