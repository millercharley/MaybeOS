import { IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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

  // Demographics are deliberately absent. The PRD collects them once, in the
  // member's own profile section, and "never inside impact micro-surveys"
  // (§6.4). Accepting them here would re-ask the same personal questions on
  // every response and spread copies of them across every survey. See IMP-17
  // and /orgs/:orgId/me/demographics.
}
