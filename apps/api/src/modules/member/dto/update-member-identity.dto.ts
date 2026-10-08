import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Correcting who a member is, on the roster (MEM-27).
 *
 * Both optional, and at least one has to change something or the service
 * answers `unchanged` — a no-op reporting success looks like a fix that did
 * not take.
 *
 * In its own file, like every other DTO beside a controller: the
 * unauthenticated-route audit reads the first class in a controller file, and
 * a DTO declared above the controller is that first class.
 */
export class UpdateMemberIdentityDto {
  /**
   * How they are named everywhere on MaybeOS.
   *
   * A label rather than a credential, so unlike the address it is not refused
   * for somebody who belongs to more than one community. The common case is an
   * admin fixing "SMITH, JANE" out of a spreadsheet import.
   */
  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'A name cannot be empty' })
  @MaxLength(120)
  name?: string;

  /**
   * The address they sign in with and a magic link is sent to.
   *
   * 320 characters is the longest an address can legally be. This is not a
   * profile field — see `updateMemberIdentity` for what it refuses and why.
   */
  @ApiPropertyOptional({ example: 'jane@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'That does not look like an email address' })
  @MaxLength(320)
  email?: string;
}
