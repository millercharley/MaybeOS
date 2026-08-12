import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * The member's answers, keyed by field (IMP-17).
 *
 * Deliberately loose here and strict in the service: `sanitizeDemographics`
 * keeps only known keys and valid options, and drops the rest. Rejecting the
 * whole submission because one key went stale would lose a profile somebody
 * sat down and filled in, for no gain — this is personal data a member chose
 * to share, not an integration contract.
 */
export class UpdateDemographicsDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { ageBand: '35_44', gender: 'prefer_not_to_say', neighborhood: '11238' },
  })
  @IsObject()
  answers: Record<string, unknown>;
}
