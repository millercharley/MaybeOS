import { IsString, IsOptional, IsArray, ArrayMaxSize, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateOrgLinkDto {
  @ApiProperty({ example: 'MaybeItsFate Store' })
  @IsString()
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: 'https://shop.example.com' })
  @IsString()
  @MaxLength(2000)
  url: string;
}

export class UpdateOrgLinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;
}

export class ReorderOrgLinksDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  linkIds: string[];
}
