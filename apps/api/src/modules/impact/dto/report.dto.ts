import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
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
