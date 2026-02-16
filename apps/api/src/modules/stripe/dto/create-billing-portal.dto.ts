import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class CreateBillingPortalDto {
  @ApiProperty({ description: 'URL to redirect when the user leaves the portal', example: 'https://app.example.com/settings/billing' })
  @IsUrl()
  returnUrl: string;
}
