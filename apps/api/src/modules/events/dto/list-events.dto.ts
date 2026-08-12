import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

/**
 * Filters for the event lists, org-scoped and public alike.
 *
 * `from` and `to` were passed to `new Date()` unchecked, so `?from=nope`
 * became an Invalid Date, reached Prisma and threw a 500. The public list
 * needs no credentials, which made that a 500 anyone could produce at will —
 * and every one of them landed in Sentry looking like a defect in MaybeOS.
 */
export class ListEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'PUBLIC' })
  @IsOptional()
  @IsString()
  visibility?: string;

  @ApiPropertyOptional({ example: 'Social' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z', description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31T00:00:00.000Z', description: 'ISO date' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
