import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCollectionDto {
  @ApiProperty({ description: 'Collection name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Emoji icon', default: '📄' })
  @IsOptional()
  @IsString()
  emoji?: string;

  @ApiPropertyOptional({ description: 'Collection description' })
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Where this sits in the list. A handbook is a sequence — "0. You BELONG"
   * comes before "1. Code of Conduct" for a reason — and the model has always
   * ordered by this while no request could set it, so everything landed at 0
   * and fell back to insertion order.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCollectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emoji?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * Where this sits in the list. A handbook is a sequence — "0. You BELONG"
   * comes before "1. Code of Conduct" for a reason — and the model has always
   * ordered by this while no request could set it, so everything landed at 0
   * and fell back to insertion order.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
