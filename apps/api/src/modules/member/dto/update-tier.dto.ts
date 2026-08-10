import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsBoolean } from 'class-validator';
import { CreateTierDto } from './create-tier.dto';

export class UpdateTierDto extends PartialType(CreateTierDto) {
  /**
   * What happens to members already subscribed when the price changes.
   *
   * Stripe Prices are immutable, so changing an amount always means creating a
   * new Price. That leaves a real choice about everyone already paying the old
   * one, and it isn't a choice the software should make silently:
   *
   *   false (default) — grandfather them. Existing members keep paying what
   *     they agreed to; only new sign-ups get the new price. Closer to co-op
   *     norms, and nobody's dues change without them acting.
   *
   *   true — move everyone to the new price at their next renewal. No
   *     mid-cycle proration, no surprise charge today, but every member's dues
   *     change. Fine for a correction; heavy-handed for an increase.
   *
   * Ignored when the price is unchanged.
   */
  @ApiPropertyOptional({
    description:
      'Move existing subscribers to the new price at their next renewal. Default false, which grandfathers them at their current price.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  applyToExistingMembers?: boolean;
}
