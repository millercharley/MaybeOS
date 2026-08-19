import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsUUID,
  IsBoolean,
} from 'class-validator';

export class CreateRoomDto {
  @ApiProperty({ example: 'Conference Room A' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Large conference room with projector' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  capacity?: number;

  @ApiPropertyOptional({ example: ['projector', 'whiteboard', 'video-conferencing'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  memberOnly?: boolean;

  /**
   * Whether members are charged to book this room (SPC-06).
   *
   * Charging is two deliberate steps, a switch and a rate, so that typing a
   * number to record what a room is worth cannot start billing members. The
   * rate was accepted here and the switch was not — and since the form always
   * sends both, the whitelist refused **every** room create and update, which
   * is why a co-op that had shipped room charging still had no rooms.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  chargeForBooking?: boolean;

  @ApiPropertyOptional({ example: 2500, description: 'Hourly rate in cents' })
  @IsOptional()
  @IsInt()
  hourlyRate?: number;
}
