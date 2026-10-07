import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Correcting the address a member is reachable at (MEM-25).
 *
 * In its own file, like every other DTO beside a controller: the
 * unauthenticated-route audit reads the first class in a controller file, and
 * a DTO declared above the controller is that first class.
 */
export class ChangeMemberEmailDto {
  /**
   * The corrected address.
   *
   * 320 characters is the longest an address can legally be, and the column
   * it lands in is what the member signs in with — this is not a profile
   * field, it is a credential.
   */
  @ApiProperty({ example: 'derek@example.com' })
  @IsEmail({}, { message: 'That does not look like an email address' })
  @MaxLength(320)
  email!: string;
}
