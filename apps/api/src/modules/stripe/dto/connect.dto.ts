import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsUrl } from 'class-validator';

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
}
