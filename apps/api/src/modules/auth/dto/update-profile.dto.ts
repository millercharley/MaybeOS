import { IsString, IsOptional, MaxLength, IsUrl, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * What a member may change about themselves.
 *
 * Deliberately not email or role. Changing an email is an identity change that
 * needs verification of the new address, and role is the org's decision, not
 * the member's — an admin sets it from the members page.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: 'Display name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Avatar image URL, or null to clear it' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl({ require_tld: false }, { message: 'avatarUrl must be a URL' })
  avatarUrl?: string | null;
}
