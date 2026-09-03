import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsInt, Max, Min, ValidateIf } from 'class-validator';
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

  /**
   * A fee the co-op adds to its own ticket sales, in cents per ticket, on top
   * of MaybeOS's (D-013). Capped at $50 — not a business rule so much as a
   * guard against a typo in a cents field becoming a $500 booking fee on a
   * $10 ticket, which the buyer would discover at Stripe.
   */
  @ApiPropertyOptional({ example: 200, minimum: 0, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  ticketFeeCents?: number;

  /**
   * What the co-op says an hour of a member's service is worth, in cents
   * (SRV-02). Null clears it, and null is the default.
   *
   * Capped at $500 an hour, which is not a judgement about anybody's time but
   * a guard against a cents-field typo turning 25 hours into a six-figure
   * "contributed value" in a grant application — a number the co-op would be
   * asserting, and would have to withdraw.
   */
  @ApiPropertyOptional({ example: 3000, minimum: 0, maximum: 50000, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(50000)
  volunteerHourValueCents?: number | null;
}
