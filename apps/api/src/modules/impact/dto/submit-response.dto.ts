import { IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitResponseDto {
  @ApiProperty({
    description: 'Answers keyed by question ID',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  answers: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Optional demographic data (consent-based)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  demographics?: Record<string, any>;
}
