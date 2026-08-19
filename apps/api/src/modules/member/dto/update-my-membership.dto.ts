import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsArray, ArrayMaxSize } from 'class-validator';

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
}
