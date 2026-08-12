import {
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsDateString,
  IsBoolean,
  IsInt,
  ValidateNested,
  ArrayNotEmpty,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SurveyTypeEnum {
  BASELINE = 'BASELINE',
  FOLLOWUP = 'FOLLOWUP',
  CUSTOM = 'CUSTOM',
}

/**
 * Mirrors the `SurveyQuestionType` enum in the schema. It is spelled out here
 * rather than imported so the API contract fails validation on an unknown
 * type instead of accepting it and storing something the renderer will not
 * recognise — the shape of IMP-04.
 */
export enum SurveyQuestionTypeEnum {
  SCALE = 'SCALE',
  NUMBER = 'NUMBER',
  CHOICE = 'CHOICE',
  TEXT = 'TEXT',
}

export class SurveyQuestionDto {
  @ApiProperty({
    description:
      'Stable identity for this question across versions. Editing wording keeps the key and bumps the version.',
    example: 'belonging_frequency',
  })
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'key must be lowercase letters, numbers and underscores',
  })
  key: string;

  @ApiProperty({ description: 'The question as the member reads it' })
  @IsString()
  text: string;

  @ApiProperty({ enum: SurveyQuestionTypeEnum })
  @IsEnum(SurveyQuestionTypeEnum)
  type: SurveyQuestionTypeEnum;

  @ApiPropertyOptional({ description: 'Allowed choices. CHOICE questions only.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({
    description:
      'The indicator this question feeds, e.g. "belonging". Answers carry it so the dashboard can aggregate without matching strings.',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateSurveyDto {
  @ApiProperty({ description: 'Survey title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Survey description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Survey type',
    enum: SurveyTypeEnum,
    default: SurveyTypeEnum.CUSTOM,
  })
  @IsOptional()
  @IsEnum(SurveyTypeEnum)
  type?: SurveyTypeEnum;

  @ApiProperty({ type: [SurveyQuestionDto] })
  @IsArray()
  @ArrayNotEmpty({ message: 'a survey needs at least one question' })
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions: SurveyQuestionDto[];

  @ApiPropertyOptional({
    description: 'Label for the first collection window, e.g. "2026 baseline"',
    default: 'Initial',
  })
  @IsOptional()
  @IsString()
  windowLabel?: string;

  @ApiPropertyOptional({ description: 'Date/time when survey closes (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
