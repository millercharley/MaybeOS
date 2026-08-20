import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkPayoutPaidDto {
  /**
   * How it was actually sent, in the organiser's words — "bank transfer 21
   * Aug", "cash at the bar". MaybeOS did not move this money and should not
   * pretend to know how it moved.
   */
  @ApiPropertyOptional({ example: 'Bank transfer, 21 August' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class SetShareDto {
  /** Basis points: 10000 is the whole ticket price, 8000 is 80%. */
  @ApiProperty({ example: 10000 })
  @IsInt()
  @Min(0)
  @Max(10000)
  shareBps!: number;
}
