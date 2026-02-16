import { IsString, IsOptional, IsEnum, IsArray, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SurveyTypeEnum {
  BASELINE = 'BASELINE',
  FOLLOWUP = 'FOLLOWUP',
  CUSTOM = 'CUSTOM',
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

  @ApiProperty({
    description: 'Array of question definitions',
    type: 'array',
    items: { type: 'object' },
  })
  @IsArray()
  questions: any[];

  @ApiPropertyOptional({ description: 'Date/time when survey closes (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
