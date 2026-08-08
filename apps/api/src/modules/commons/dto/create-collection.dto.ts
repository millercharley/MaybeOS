import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCollectionDto {
  @ApiProperty({ description: 'Collection name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: 'Emoji icon', default: '📄' })
  @IsOptional()
  @IsString()
  emoji?: string;

  @ApiPropertyOptional({ description: 'Collection description' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateCollectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emoji?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
