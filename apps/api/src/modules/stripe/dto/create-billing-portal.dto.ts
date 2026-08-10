import { ApiProperty } from '@nestjs/swagger';
import { IsUrl } from 'class-validator';

export class CreateBillingPortalDto {
  @ApiProperty({ description: 'URL to redirect when the user leaves the portal', example: 'https://app.example.com/settings/billing' })
  // require_tld: false so http://localhost:3000 validates. class-validator's
  // default demands a TLD, which silently makes every local checkout fail
  // with "must be a URL address" while production works fine.
  @IsUrl({ require_tld: false })
  returnUrl: string;
}
