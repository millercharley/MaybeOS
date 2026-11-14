import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../password-reset';

/** Redeeming a reset link (AUTH-09). */
export class ResetPasswordDto {
  /**
   * In the body, never the path.
   *
   * A path segment ends up in route labels, access logs and Sentry
   * transaction names; `safePath` in the web client exists because of that,
   * and the API should not be handing it the problem in the first place.
   */
  @ApiProperty({ description: 'The token from the emailed link' })
  @IsString()
  token: string;

  /**
   * The same floor as `ChangePasswordDto`, from the same constant the service
   * reads — two places deciding what counts as long enough is how one of them
   * ends up more permissive than the other.
   */
  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: `Use at least ${MIN_PASSWORD_LENGTH} characters` })
  newPassword: string;
}
