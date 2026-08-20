import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SuspendOrgDto {
  /**
   * Required, and shown to the co-op in its own audit log.
   *
   * A suspension with no stated reason is one nobody can appeal, and the
   * organiser reading it is about to lose access to their own membership
   * list.
   */
  @ApiProperty({ example: 'Repeated abuse reports, pending review' })
  @IsString()
  @MinLength(4)
  @MaxLength(300)
  reason!: string;
}

export class SetPlanDto {
  @ApiPropertyOptional({ enum: ['FREE', 'PLUS', 'UNLIMITED'] })
  @IsOptional()
  @IsEnum(['FREE', 'PLUS', 'UNLIMITED'])
  plan?: 'FREE' | 'PLUS' | 'UNLIMITED';

  /** Stop charging for the plan the co-op is on, without changing the plan. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  billingWaived?: boolean;

  @ApiPropertyOptional({ example: 'Founding co-op, comped indefinitely' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
