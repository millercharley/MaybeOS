import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'The password you currently sign in with' })
  @IsString()
  currentPassword: string;

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
