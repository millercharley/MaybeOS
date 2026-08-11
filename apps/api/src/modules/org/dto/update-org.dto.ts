import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
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

  /**
   * Whether anyone can join from the org's public page. Default false, so an
   * org stays invitation-only until it deliberately opens up. See D-020.
   */
  @ApiPropertyOptional({ example: false, default: false })
  @IsOptional()
  @IsBoolean()
  allowPublicJoin?: boolean;
}
