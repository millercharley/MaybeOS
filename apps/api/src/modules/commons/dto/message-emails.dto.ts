import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Whether this member is emailed when somebody writes to them (CMN-19).
 *
 * In its own file like every other DTO beside a controller: the
 * unauthenticated-route audit reads the first class in a controller file, and
 * a DTO declared above the controller is that first class.
 */
export class MessageEmailsDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  messageEmails!: boolean;
}
