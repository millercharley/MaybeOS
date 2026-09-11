import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsUUID,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GRANT_KINDS, GrantKind } from '../ledger';

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

/**
 * Shares granted in MaybeOS, to one member or a selection (MEM-19). The
 * rules a grant must meet live in `grantProblem`, so the preview and the
 * server cannot disagree about them.
 */
export class GrantSharesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @ApiProperty({ enum: GRANT_KINDS })
  @IsIn(GRANT_KINDS as unknown as string[])
  kind!: GrantKind;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(-MAX_SHARES)
  @Max(MAX_SHARES)
  shares!: number;

  @ApiPropertyOptional({ example: '2026 annual patronage grant' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** Set one member's balance to a figure, recorded as an adjustment (MEM-19). */
export class SetTotalDto {
  @ApiProperty({ example: 1200 })
  @IsInt()
  @Min(0)
  @Max(MAX_SHARES)
  total!: number;

  /** The balance the admin was looking at. Refused if it has moved since. */
  @ApiProperty({ example: 1000 })
  @IsInt()
  expectedCurrent!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
