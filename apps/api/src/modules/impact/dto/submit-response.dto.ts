import { IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitResponseDto {
  @ApiProperty({
    description:
      'Answers keyed by question key (not id): { "belonging_frequency": 4, "what_community_means": "..." }. ' +
      'Values are validated against the question type — a SCALE must be 1-5, a CHOICE must be one of its options.',
    type: 'object',
    additionalProperties: true,
    example: { belonging_frequency: 4, participation: 'Weekly' },
  })
  @IsObject()
  answers: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Optional demographic data (consent-based). Stored on the response, never inside the answers.',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  demographics?: Record<string, unknown>;
}
