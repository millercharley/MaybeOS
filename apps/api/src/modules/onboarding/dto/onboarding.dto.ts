import {
  IsString, IsOptional, IsBoolean, IsEnum, IsArray, ArrayMaxSize, ValidateIf, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OnboardingStepKind } from '@prisma/client';

export class SetEnabledDto {
  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class CreateStepDto {
  @ApiPropertyOptional({ enum: OnboardingStepKind, default: 'CUSTOM' })
  @IsOptional()
  @IsEnum(OnboardingStepKind)
  kind?: OnboardingStepKind;

  @ApiProperty({ example: 'Complete your profile' })
  @IsString()
  @MaxLength(120)
  title: string;

  /** Shown only while the step is the active one. Null clears it. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  description?: string | null;

  @ApiPropertyOptional({ example: 'Do it now' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string;

  /**
   * Where the button goes. A built-in kind resolves its own and can leave this
   * null; a CUSTOM step without one renders no button at all.
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  href?: string | null;
}

export class UpdateStepDto {
  @ApiPropertyOptional({ enum: OnboardingStepKind })
  @IsOptional()
  @IsEnum(OnboardingStepKind)
  kind?: OnboardingStepKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(400)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ctaLabel?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  href?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReorderStepsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  stepIds: string[];
}
