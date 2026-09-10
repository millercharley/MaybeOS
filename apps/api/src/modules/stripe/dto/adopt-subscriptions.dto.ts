import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One Stripe price, and the tier it grants (MIG-02).
 *
 * The amounts do not have to agree. A tier legitimately spans several prices —
 * that is what a grandfathered member *is* — and requiring a match is what
 * pushed the first co-op through this to edit its live price list so its own
 * history would import.
 */
export class PriceTierMappingDto {
  @ApiProperty({ example: 'price_1QC0pdDaRqv0hdwbmTiIXr1U' })
  @IsString()
  @MaxLength(255)
  priceId!: string;

  @ApiProperty({ description: 'A tier belonging to this co-op' })
  @IsUUID()
  tierId!: string;
}

export class AdoptSubscriptionsDto {
  @ApiProperty({ type: [PriceTierMappingDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PriceTierMappingDto)
  mapping!: PriceTierMappingDto[];

  /**
   * Default true, and deliberately so. A caller that forgets this parameter
   * gets the preview, not 371 memberships.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** How many subscriptions to write in this call. */
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** The last subscription id written, to carry on from. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  after?: string;
}
