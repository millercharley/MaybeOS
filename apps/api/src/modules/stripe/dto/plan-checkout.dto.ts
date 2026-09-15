import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

/** A paid MaybeOS plan, chosen on the landing page (PAY-09). */
export class PlanCheckoutDto {
  @ApiProperty({ enum: ['PLUS', 'UNLIMITED'] })
  @IsIn(['PLUS', 'UNLIMITED'])
  plan!: 'PLUS' | 'UNLIMITED';

  @ApiProperty({ enum: ['month', 'year'] })
  @IsIn(['month', 'year'])
  interval!: 'month' | 'year';
}
