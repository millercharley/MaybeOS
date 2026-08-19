import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, ArrayMaxSize, IsUrl } from 'class-validator';

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
  @ApiPropertyOptional({ example: 'Potter, gardener, reluctant treasurer.' })
  @IsOptional()
  @IsString()
  // Long enough for a real introduction, short enough that the directory stays
  // scannable — this is a card in a grid, not a homepage.
  @MaxLength(600)
  bio?: string;

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
  @ArrayMaxSize(8)
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true })
  @MaxLength(300, { each: true })
  links?: string[];
}
