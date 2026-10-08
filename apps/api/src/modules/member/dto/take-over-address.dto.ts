import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

/**
 * Taking an address back from a removed account (MEM-28).
 *
 * In its own file, like every other DTO beside a controller: the
 * unauthenticated-route audit reads the first class in a controller file, and
 * a DTO declared above the controller is that first class.
 */
export class TakeOverAddressDto {
  /** The address the removed account is still holding. */
  @ApiProperty({ example: 'evan.mascagni@gmail.com' })
  @IsEmail({}, { message: 'That does not look like an email address' })
  @MaxLength(320)
  email!: string;
}
