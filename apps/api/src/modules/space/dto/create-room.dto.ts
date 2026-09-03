import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsArray,
  IsUUID,
  IsBoolean,
  Min,
  Max,
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
   * Bookable at any hour.
   *
   * Without it, a room with no availability rules was treated as always open —
   * so "open all hours" and "nobody has set the hours yet" were the same state.
   * Unchecked with no rules now means not bookable, which is the safe reading
   * of an unfinished room.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  alwaysAvailable?: boolean;

  /**
   * The longest a single booking may run, in minutes (SPC-15).
   *
   * Absent or null means no cap, which is what every room built before this
   * existed has. Whitelisted here deliberately: the API strips unknown
   * properties and rejects the request, so a field the form sends and the DTO
   * does not know breaks every room save — which is how room charging shipped
   * with a form that could not succeed.
   */
  @ApiPropertyOptional({ example: 180, description: 'Minutes; null means no cap' })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(24 * 60)
  maxBookingMinutes?: number | null;

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
