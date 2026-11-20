import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsNullByteFree } from '../../../common/no-null-bytes';

/**
 * Filters for the event lists, org-scoped and public alike.
 *
 * `from` and `to` were passed to `new Date()` unchecked, so `?from=nope`
 * became an Invalid Date, reached Prisma and threw a 500. The public list
 * needs no credentials, which made that a 500 anyone could produce at will —
 * and every one of them landed in Sentry looking like a defect in MaybeOS.
 *
 * The same thing was still true of `category` and `visibility` until the
 * production smoke test on 19 November found `?category=%00` answering 500 on
 * the live site. They are typed as plain strings, so a NUL passed validation
 * and died at Postgres, which will not store one. Fixing the two fields that
 * had been reported had left the third and fourth exactly as they were — see
 * `IsNullByteFree`.
 */
export class ListEventsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'PUBLIC' })
  @IsOptional()
  @IsString()
  @IsNullByteFree()
  visibility?: string;

  @ApiPropertyOptional({ example: 'Social' })
  @IsOptional()
  @IsString()
  @IsNullByteFree()
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
