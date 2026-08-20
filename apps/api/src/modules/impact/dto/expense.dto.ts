import { IsInt, IsOptional, IsPositive, IsString, IsDateString, MaxLength, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One expense (IMP-16). Four fields, and that is the whole point — see
 * `expense.service.ts` for what is deliberately absent.
 */
export class CreateExpenseDto {
  @ApiProperty({ description: 'Integer cents. Money in floats stops adding up.' })
  @IsInt()
  @IsPositive()
  amountCents!: number;

  @ApiProperty({ description: 'The day the money went out (ISO date).' })
  @IsDateString()
  incurredOn!: string;

  @ApiProperty({ description: "The co-op's own word for this kind of spend." })
  @IsString()
  @MaxLength(60)
  category!: string;

  @ApiPropertyOptional({
    description:
      'The goal this spend served, if any. Null is normal and honest — not all spend serves a stated goal.',
  })
  @IsOptional()
  @IsUUID()
  goalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  amountCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  incurredOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  goalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
