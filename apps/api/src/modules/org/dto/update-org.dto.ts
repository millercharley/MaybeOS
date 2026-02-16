import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CreateOrgDto } from './create-org.dto';

export class UpdateOrgDto extends PartialType(CreateOrgDto) {
  @ApiPropertyOptional({ example: '#6366f1' })
  @IsOptional()
  @IsString()
  brandColor?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/logo.png' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
