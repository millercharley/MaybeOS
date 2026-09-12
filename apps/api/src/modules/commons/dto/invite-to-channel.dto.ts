import { IsArray, IsUUID, ArrayMaxSize, ArrayNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Invite members to a channel (CMN-11).
 *
 * Capped at 50 in one go. Every invitation is a direct message somebody
 * receives, so an uncapped list is a way to message the entire co-op from a
 * single click — which is a broadcast, and a broadcast is a different feature
 * with different permissions.
 */
export class InviteToChannelDto {
  @ApiProperty({ description: 'The members to invite.', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  userIds: string[];

  @ApiPropertyOptional({ description: 'A line to send with the invitation.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
