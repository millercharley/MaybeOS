import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Turning a room booking into an event (EVT-05).
 *
 * Everything is optional, because the booking already answers most of it —
 * when, where, and what the member called it. Asking them to retype the time
 * and room they just chose is how the two end up disagreeing.
 */
export class PublishBookingEventDto {
  @ApiPropertyOptional({
    description: "Defaults to the booking's own title.",
    example: 'Repair Café',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'What people should know before coming.' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({
    enum: ['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE'],
    description:
      'Defaults to MEMBERS_ONLY. PUBLIC puts the event on the co-op\'s public page, where anyone can see it.',
  })
  @IsOptional()
  @IsEnum(['PUBLIC', 'MEMBERS_ONLY', 'PRIVATE'])
  visibility?: string;

  @ApiPropertyOptional({ description: "Defaults to the room's capacity." })
  @IsOptional()
  @IsInt()
  capacity?: number;

  @ApiPropertyOptional({ example: 'Workshop' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'Publish immediately. False creates it as a draft the host can finish later.',
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
