import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChannelDto {
  @ApiProperty({ description: 'Channel name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Channel description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the channel is publicly visible', default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
