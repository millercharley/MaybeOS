import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Page and page size, validated rather than trusted.
 *
 * These arrived as raw strings and went through `parseInt` with nothing
 * checking the result: `?page=abc` produced NaN, `?page=0` and `?page=-5`
 * produced a negative `skip`, and each reached Prisma, threw, and came back as
 * a 500 reported to Sentry as a server fault. They are client mistakes — 400.
 *
 * `perPage` is capped. It was unbounded, so `?perPage=99999` answered 200 and
 * asked the database for every row; on `/events/public`, which needs no
 * credentials at all, that is a free lever on the database for anyone who
 * finds it.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perPage?: number;
}
