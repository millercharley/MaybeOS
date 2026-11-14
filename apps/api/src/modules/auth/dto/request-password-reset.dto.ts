import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

/** Asking for a reset link (AUTH-09). The address, and nothing else. */
export class RequestPasswordResetDto {
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail()
  email: string;
}
