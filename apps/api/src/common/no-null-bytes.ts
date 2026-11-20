import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * A free-text filter may not carry a NUL.
 *
 * Postgres cannot store `\u0000` in a text value and refuses the whole
 * statement, so a NUL in a filter does not match nothing — it throws, from
 * inside Prisma, after validation has already passed. On
 * `/orgs/:orgId/events/public`, which needs no credentials, `?category=%00`
 * was a 500 that anyone could produce at will, and every one of them landed
 * in Sentry looking like a defect in MaybeOS.
 *
 * This is the same incident `ListEventsQueryDto` and `PaginationQueryDto`
 * already describe in their own docblocks, one field over. `from`, `to`,
 * `page` and `perPage` were fixed because those were the four that had been
 * reported; `category` and `visibility` are plain strings, so nothing stood
 * between them and the database. The shape of the bug was never those field
 * names — it is a free-text filter reaching Prisma unchecked, and that is
 * what this guards.
 *
 * It rejects rather than strips: a NUL in a category is a client mistake, and
 * the rule in this codebase is that a client mistake answers 400. Stripping
 * would silently answer a question nobody asked.
 */
export function containsNullByte(value: unknown): boolean {
  return typeof value === 'string' && value.includes('\u0000');
}

export function IsNullByteFree(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNullByteFree',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must not contain a null byte`, ...options },
      validator: { validate: (value: unknown) => !containsNullByte(value) },
    });
  };
}
