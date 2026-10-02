import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RunCalendarImportDto } from '../dto/calendar-import.dto';
import { nextCursor } from '../import-cursor';

/**
 * The cursor the API hands out must be one the API will take back (CAL-08).
 *
 * The import stopped on its second request with "resumeFrom.property page
 * should not exist". The cursor had gained Google's page token; the DTO that
 * validates it coming back had not, and the whitelist did exactly what it is
 * for.
 *
 * Nothing caught it, because every test on either side was right: the server
 * produced a correct cursor, the client sent back what it was given, and the
 * validator correctly rejected a field it had never been told about. The
 * round trip was the only place the mistake existed.
 */

const validate = (body: unknown) =>
  validateSync(plainToInstance(RunCalendarImportDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

const problems = (body: unknown) =>
  validate(body).flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...(e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {})),
  ]);

describe('a cursor the API produced is a cursor it accepts', () => {
  const page = { token: 'tok-1', nextToken: 'tok-2', length: 250 };

  it('takes one that points further into the same page', () => {
    const cursor = nextCursor(0, 9, page, 0, 100);

    expect(problems({ dryRun: false, resumeFrom: cursor })).toEqual([]);
  });

  it('takes one that points at Google’s next page', () => {
    // The shape that was rejected: `page` carrying a token.
    const cursor = nextCursor(0, 9, page, 0, 250);

    expect(cursor?.page).toBe('tok-2');
    expect(problems({ dryRun: false, resumeFrom: cursor })).toEqual([]);
  });

  it('takes one that points at the next calendar, with no page', () => {
    const cursor = nextCursor(0, 9, { ...page, nextToken: null }, 0, 250);

    expect(cursor?.page).toBeNull();
    expect(problems({ dryRun: false, resumeFrom: cursor })).toEqual([]);
  });

  it('takes a first request, with no cursor at all', () => {
    expect(problems({ dryRun: false, monthsBack: 24 })).toEqual([]);
  });
});

describe('what it still refuses', () => {
  it('refuses a field nobody declared', () => {
    // The guard is worth keeping — it is how the mistake above surfaced at
    // all, rather than being silently ignored.
    expect(problems({ resumeFrom: { calendar: 0, entry: 0, somethingElse: 1 } }).join(' ')).toMatch(
      /should not exist/,
    );
  });

  it('refuses a page token that is not a string', () => {
    expect(problems({ resumeFrom: { calendar: 0, entry: 0, page: 42 } }).join(' ')).toMatch(
      /page must be a string/i,
    );
  });

  it('refuses an absurd page token rather than handing it to Google', () => {
    expect(
      problems({ resumeFrom: { calendar: 0, entry: 0, page: 'x'.repeat(5000) } }).join(' '),
    ).toMatch(/2048/);
  });
});
