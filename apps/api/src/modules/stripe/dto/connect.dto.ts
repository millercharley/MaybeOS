import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsUrl, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_SEATS_PER_PURCHASE } from '../ticket-pricing';

export class ConnectOnboardingDto {
  @ApiProperty({ description: 'Where Stripe returns the admin when onboarding finishes' })
  @IsUrl({ require_tld: false })
  returnUrl: string;

  @ApiProperty({ description: 'Where Stripe sends them if the link has expired' })
  @IsUrl({ require_tld: false })
  refreshUrl: string;
}

export class TicketCheckoutDto {
  @ApiProperty()
  @IsUrl({ require_tld: false })
  successUrl: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  cancelUrl: string;

  /** Prefills Stripe checkout for a buyer with no account. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * How many seats (EVT-47).
   *
   * Optional, defaulting to one in the service rather than here, so a client
   * written before the selector existed keeps working unchanged.
   *
   * `@Type` is load-bearing: this arrives as JSON from a public page, and
   * without the transform `"3"` reaches `@IsInt` as a string and is refused
   * — a validation error on the one route used by people with no account.
   * The service validates the range again, because this guards the request
   * and that guards the charge.
   */
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_SEATS_PER_PURCHASE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEATS_PER_PURCHASE)
  quantity?: number;
}
