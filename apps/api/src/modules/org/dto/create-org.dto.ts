import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, Matches } from 'class-validator';

export class CreateOrgDto {
  @ApiProperty({ example: 'My Organization' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'my-organization',
    description: 'URL-safe slug: lowercase letters, numbers, and hyphens only',
  })
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must contain only lowercase letters, numbers, and hyphens',
  })
  slug: string;

  @ApiPropertyOptional({ example: 'A community-driven organization' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'Empowering communities everywhere' })
  @IsOptional()
  @IsString()
  mission?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  timezone?: string;
}
