import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean, IsInt, Max, Min } from 'class-validator';
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
}
