import { ApiProperty } from '@nestjs/swagger';
import { IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { AvailabilityRuleDto } from './availability-rule.dto';

export class OpeningHoursDto {
  @ApiProperty({
    type: [AvailabilityRuleDto],
    description:
      "The room's complete opening hours. Replaces what is stored; blackout rules are left alone.",
  })
  @IsArray()
  // Seven days, and at most a handful of windows each. A cap so a malformed
  // client cannot write thousands of rules the slot engine then walks per slot.
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityRuleDto)
  rules: AvailabilityRuleDto[];
}
