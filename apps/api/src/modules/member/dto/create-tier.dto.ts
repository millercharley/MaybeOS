import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
} from 'class-validator';

export class CreateTierDto {
  @ApiProperty({ example: 'Gold Membership' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Full access to all community benefits' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 2500, description: 'Monthly price in cents' })
  @IsInt()
  priceMonthly: number;

  @ApiPropertyOptional({ example: 25000, description: 'Yearly price in cents' })
  @IsOptional()
  @IsInt()
  priceYearly?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isPayWhatYouCan?: boolean;

  @ApiPropertyOptional({
    example: 500,
    description: 'Minimum price in cents for pay-what-you-can tiers',
  })
  @IsOptional()
  @IsInt()
  minPrice?: number;

  @ApiPropertyOptional({
    example: ['Access to events', 'Community forum', 'Monthly newsletter'],
    description: 'List of benefits included in this tier',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  benefits?: string[];
}
