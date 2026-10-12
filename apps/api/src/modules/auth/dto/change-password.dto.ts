import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  /**
   * Optional, because 433 of MaybeItsFate's 439 members have no password
   * (AUTH-04).
   *
   * Everyone who came in through a sign-in link has an account with no
   * password at all, and this field used to be required — so the one screen
   * for setting one refused them all with "this account has no password set,
   * so there is nothing to change". Required when there *is* one; the
   * service decides, because only it knows.
   */
  @ApiPropertyOptional({ description: 'The password you currently sign in with, if you have one' })
  @IsOptional()
  @IsString()
  currentPassword?: string;

  /**
   * Eight is the floor rather than a policy. Length is what actually resists
   * an offline attack on a stolen hash, which is precisely the situation that
   * made this endpoint necessary.
   */
  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Use at least 8 characters' })
  newPassword: string;
}
