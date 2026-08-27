import { IsIn, IsISO8601, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class GenerateReportDto {
  @ApiPropertyOptional({ example: 'MaybeItsFate: 2026 impact' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  /** Defaults to the twelve months ending today. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  /**
   * Which report to write (IMP-23). BASIC is the free deterministic reading
   * and is what an admin gets by asking for nothing. WRITTEN is the composed
   * one — free to generate and read, paid for at publish or export.
   */
  @ApiPropertyOptional({ enum: ['BASIC', 'WRITTEN'], default: 'BASIC' })
  @IsOptional()
  @IsIn(['BASIC', 'WRITTEN'])
  tier?: 'BASIC' | 'WRITTEN';
}

export class UpdateReportBlockDto {
  /**
   * Prose only. The figures a block rests on are not editable — an editable
   * number in a document that claims every figure traces to a response count
   * is not a report, it is a form.
   */
  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  body!: string;
}

export class BuyReportDto {
  /** Where Stripe returns the admin once the report is paid for. */
  @ApiProperty()
  @IsUrl({ require_tld: false })
  successUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  cancelUrl!: string;
}
