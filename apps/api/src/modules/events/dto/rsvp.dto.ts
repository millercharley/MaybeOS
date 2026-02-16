import { IsString, IsOptional, IsEmail, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RsvpDto {
  @ApiPropertyOptional({ description: 'Guest name (for non-member RSVPs)' })
  @IsOptional()
  @IsString()
  guestName?: string;

  @ApiPropertyOptional({ description: 'Guest email (for non-member RSVPs)' })
  @IsOptional()
  @IsEmail()
  guestEmail?: string;

  @ApiPropertyOptional({ description: 'Number of additional guests', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  plusOnes?: number;

  @ApiPropertyOptional({ description: 'Optional note from the attendee' })
  @IsOptional()
  @IsString()
  note?: string;
}
