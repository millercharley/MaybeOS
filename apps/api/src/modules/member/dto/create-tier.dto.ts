import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  IsIn,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';

/** How often a tier's service expectation resets (SRV-01). */
export const SERVICE_PERIODS = ['WEEK', 'MONTH', 'YEAR'] as const;

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

  /**
   * What this tier asks of a member in service (SRV-01).
   *
   * Both nullable, and both must be present or absent together — minutes with
   * no period is a number over no stretch of time, and a period with no
   * minutes is a stretch of time with nothing asked in it. Enforced in
   * `member.service.ts` rather than here, because class-validator cannot
   * express "these two travel together" without a custom constraint.
   *
   * Explicit null is how an expectation is *removed*, which is why these are
   * `Int | null` rather than plain optional ints: an omitted field means
   * "leave it alone" on a PATCH, and there has to be a way to say "no longer".
   */
  @ApiPropertyOptional({
    example: 240,
    nullable: true,
    description: 'Minutes of service expected per period. Null for no expectation.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(5)
  @Max(100 * 60)
  serviceMinutes?: number | null;

  @ApiPropertyOptional({ enum: SERVICE_PERIODS, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(SERVICE_PERIODS as unknown as string[])
  servicePeriod?: string | null;
}
