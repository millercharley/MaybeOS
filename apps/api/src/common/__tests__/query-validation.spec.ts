import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { PaginationQueryDto } from '../dto/pagination.dto';
import { ListBookingsQueryDto } from '../../modules/space/dto/list-bookings.dto';
import { ListEventsQueryDto } from '../../modules/events/dto/list-events.dto';

/**
 * A malformed query is a 400, not a 500.
 *
 * These query parameters were read as raw strings and handed to `new Date()`
 * and `parseInt` with nothing checking the results. `?from=nope` became an
 * Invalid Date, `?page=abc` became NaN, and `?page=0` became a negative
 * `skip` — each reached Prisma, threw, and surfaced as a 500 that Sentry
 * recorded as a server fault. `/orgs/:orgId/events/public` needs no
 * credentials, so anyone could generate those at will.
 *
 * The pipe here is configured exactly as `app-setup.ts` configures the global
 * one, so what passes and fails below is what passes and fails in the app.
 */
describe('query validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const meta = (metatype: unknown): ArgumentMetadata => ({
    type: 'query',
    metatype: metatype as ArgumentMetadata['metatype'],
  });

  const run = (dto: unknown, value: Record<string, unknown>) =>
    pipe.transform(value, meta(dto));

  describe('room bookings — the date range is required', () => {
    it('rejects a missing range instead of building an Invalid Date', async () => {
      await expect(run(ListBookingsQueryDto, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an unparseable date', async () => {
      await expect(
        run(ListBookingsQueryDto, { from: 'nope', to: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts an ISO range', async () => {
      await expect(
        run(ListBookingsQueryDto, {
          from: '2026-08-01T00:00:00.000Z',
          to: '2026-08-31T00:00:00.000Z',
        }),
      ).resolves.toEqual({
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-31T00:00:00.000Z',
      });
    });
  });

  describe('event lists — filters are optional but must be well formed', () => {
    it('accepts no filters at all', async () => {
      await expect(run(ListEventsQueryDto, {})).resolves.toEqual({});
    });

    it('rejects an unparseable from', async () => {
      await expect(
        run(ListEventsQueryDto, { from: 'nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('coerces page and perPage to numbers, since they arrive as strings', async () => {
      await expect(
        run(ListEventsQueryDto, { page: '2', perPage: '50' }),
      ).resolves.toEqual({ page: 2, perPage: 50 });
    });
  });

  describe('pagination bounds', () => {
    it.each(['abc', '0', '-5', '1.5'])('rejects page=%s', async (page) => {
      await expect(run(PaginationQueryDto, { page })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('caps perPage, so the public list cannot be asked for every row', async () => {
      await expect(
        run(PaginationQueryDto, { perPage: '99999' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(run(PaginationQueryDto, { perPage: '100' })).resolves.toEqual({
        perPage: 100,
      });
    });
  });
});
