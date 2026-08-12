import { IsString, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OpenWindowDto {
  @ApiProperty({
    description: 'Human label for this round of collection',
    example: '2027 follow-up',
  })
  @IsString()
  label: string;

  @ApiPropertyOptional({
    description: 'When the window stops accepting responses (ISO 8601). Open-ended if omitted.',
  })
  @IsOptional()
  @IsDateString()
  closesAt?: string;
}
