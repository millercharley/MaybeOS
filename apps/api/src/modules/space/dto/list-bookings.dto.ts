import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

/**
 * The date range a room's booking list is read over.
 *
 * Both were documented as required and neither was checked. Omitting them —
 * or sending anything unparseable — built `new Date(undefined)`, an Invalid
 * Date, which reached Prisma and threw. The caller got a 500 and Sentry got a
 * server fault for what is a malformed request.
 */
export class ListBookingsQueryDto {
  @ApiProperty({ example: '2026-08-01T00:00:00.000Z', description: 'ISO date string' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-08-31T23:59:59.000Z', description: 'ISO date string' })
  @IsDateString()
  to: string;
}
