import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, ArrayMaxSize, IsUrl, IsBoolean } from 'class-validator';

/**
 * What a member may change about how they appear in their co-op (MEM-09).
 *
 * Scoped to the caller's own membership — there is no userId here, so this
 * route cannot be pointed at somebody else's profile however it is called.
 *
 * On `UserOrg` rather than `User` for the reason D-020 and IMP-17 both give:
 * orgs are firewalled, and what somebody writes about themselves for one co-op
 * is not consent to publish it in another.
 */
export class UpdateMyMembershipDto {
  @ApiPropertyOptional({ example: 'Ask me anything about sourdough' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  headline?: string;

  @ApiPropertyOptional({ example: 'Butchertown, KY' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @ApiPropertyOptional({ example: 'Potter, gardener, reluctant treasurer.' })
  @IsOptional()
  @IsString()
  // Raised from 600 to match what an import can bring in (MEM-06). A member
  // whose imported bio is 1,800 characters must be able to save their own
  // profile without being told to cut it down; the directory truncates for
  // scanning rather than the database truncating for storage.
  @MaxLength(2000)
  bio?: string;

  /**
   * Whether this co-op may email them about anything beyond running their
   * membership. Nullable in the database — never asked — but a member setting
   * it here is answering, so only true and false arrive.
   *
   * Editable by the member themselves and not only by an organiser, because
   * MEM-06 imports this consent from another platform: bringing a marketing
   * list across without giving those people a way to withdraw it would be the
   * wrong half of the feature.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailOptIn?: boolean;

  @ApiPropertyOptional({ example: ['ceramics', 'carpentry'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  /**
   * Links a member shows on their profile.
   *
   * `IsUrl` with the protocols pinned is the load-bearing part, not a
   * formality. These are rendered as anchors on a page every other member
   * reads, so a stored `javascript:` URL would be script running in their
   * browser under the co-op's own domain — the classic self-XSS-by-profile.
   * `require_protocol` also stops `evil.com` being saved as a relative link
   * that resolves inside MaybeOS.
   */
  @ApiPropertyOptional({ example: ['https://www.instagram.com/millercharley/'] })
  @IsOptional()
  @IsArray()
  // Matches the import ceiling for the same reason as `bio`: a member must
  // always be able to re-save the profile that was imported for them.
  @ArrayMaxSize(25)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  @MaxLength(500, { each: true })
  links?: string[];
}
