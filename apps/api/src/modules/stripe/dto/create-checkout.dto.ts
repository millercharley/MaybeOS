import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUrl } from 'class-validator';

export class CreateCheckoutDto {
  @ApiProperty({ description: 'Membership tier ID to subscribe to' })
  @IsString()
  tierId: string;

  @ApiProperty({ description: 'URL to redirect on successful checkout', example: 'https://app.example.com/checkout/success' })
  @IsUrl()
  successUrl: string;

  @ApiProperty({ description: 'URL to redirect on canceled checkout', example: 'https://app.example.com/checkout/cancel' })
  @IsUrl()
  cancelUrl: string;
}
