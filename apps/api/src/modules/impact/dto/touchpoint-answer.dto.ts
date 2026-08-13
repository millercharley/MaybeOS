import { IsDefined } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * One answer given at a touchpoint (IMP-15).
 *
 * A single value, because a touchpoint asks a single question — the fatigue
 * budget is spent per ask, so a form that could carry several would be a
 * survey wearing a micro-question's clothes.
 */
export class TouchpointAnswerDto {
  @ApiProperty({
    description: 'The answer: a scale number, a chosen option, or free text.',
    oneOf: [{ type: 'string' }, { type: 'number' }],
  })
  @IsDefined()
  value!: string | number;
}
