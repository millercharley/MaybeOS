import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUrl, IsOptional, IsInt, Min } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({ description: 'Membership tier ID to subscribe to' })
  @IsString()
  tierId: string;

  @ApiPropertyOptional({
    description:
      'Monthly amount in cents, chosen by the member. Required for pay-what-you-can tiers and rejected for fixed-price ones. Validated server-side against the tier minimum — never trust this value alone.',
    example: 1500,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @ApiProperty({ description: 'URL to redirect on successful checkout', example: 'https://app.example.com/checkout/success' })
  // require_tld: false so http://localhost:3000 validates. class-validator's
  // default demands a TLD, which silently makes every local checkout fail
  // with "must be a URL address" while production works fine.
  @IsUrl({ require_tld: false })
  successUrl: string;

  @ApiProperty({ description: 'URL to redirect on canceled checkout', example: 'https://app.example.com/checkout/cancel' })
  // require_tld: false so http://localhost:3000 validates. class-validator's
  // default demands a TLD, which silently makes every local checkout fail
  // with "must be a URL address" while production works fine.
  @IsUrl({ require_tld: false })
  cancelUrl: string;
}
