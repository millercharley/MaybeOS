import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'secureP@ss1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsString()
  @IsOptional()
  name?: string;

  /**
   * The invitation that brought them here, if there was one (AUTH-10).
   *
   * An invitation is emailed to one address, so holding its token proves
   * that address and this registration skips the verification step. Without
   * it an invitee would be sent a second email to find.
   *
   * Declared because the pipe is `forbidNonWhitelisted`: an undeclared
   * field would 400 the whole request rather than be ignored.
   */
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  inviteToken?: string;
}
