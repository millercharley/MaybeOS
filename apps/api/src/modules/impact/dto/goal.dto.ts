import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What a co-op says it is for, and what it is doing about it (IMP-21).
 *
 * Lengths are short on purpose. The PRD asks for plain language, and a goal
 * that needs three hundred words is several goals — which the five-goal
 * ceiling is there to force a co-op to notice.
 */
export class SetMissionDto {
  @ApiProperty({ example: 'A city where nobody has to face a hard week alone.' })
  @IsString()
  @MaxLength(500)
  mission!: string;
}

export class CreateGoalDto {
  @ApiProperty({ example: 'People who come here make friends they keep' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;
}

export class UpdateGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string;
}

export class AddIndicatorDto {
  /**
   * Validated against what MaybeOS actually asks, in the service rather than
   * here: the allowed set comes from the question catalogue, and duplicating
   * it in a decorator is how the writer and the reader end up disagreeing
   * (which is what IMP-04 was).
   */
  @ApiProperty({ example: 'belonging' })
  @IsString()
  @MaxLength(60)
  category!: string;

  @ApiProperty({ example: 'How much people feel they belong here' })
  @IsString()
  @MaxLength(160)
  label!: string;
}
