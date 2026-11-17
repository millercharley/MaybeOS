import { ValidationPipe } from '@nestjs/common';
import { CreateOfferingDto, UpdateOfferingDto } from '../dto/offering.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * The teaching forms' bodies must survive the API's whitelist (TCH-02).
 *
 * Written on 2026-11-17, when adding dates to the create form. The DTO file
 * has claimed since TCH-01 that "`offering-dto.spec.ts` runs the real form
 * body through the real pipe" — and it did not exist. A comment is not a
 * guard.
 *
 * The whitelist forbids unknown fields, so one key the form sends that the
 * DTO does not declare rejects the **whole** save rather than that field.
 * `UpdateEventDto` learned this twice (EVT-21), which is why this file copies
 * its shape rather than inventing one.
 *
 * The options are production's, imported rather than re-typed.
 */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

const create = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: CreateOfferingDto });
const update = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: UpdateOfferingDto });

/** What `OfferingForm` sends when a teacher writes a workshop up. */
const CREATE_FORM_BODY = {
  kind: 'WORKSHOP',
  title: 'Beginner wheel throwing',
  summary: 'Four Tuesdays, no experience needed.',
  richDescription: '<p>Bring an apron.</p>',
  visibility: 'MEMBERS_ONLY',
  payment: 'ARRANGE_DIRECTLY',
  priceCents: null,
  priceNote: 'Sliding scale',
};

/** The dates the create form now sends alongside it (TCH-02). */
const WITH_DATES = {
  ...CREATE_FORM_BODY,
  sessions: [
    {
      title: 'Week one: centring',
      startTime: '2026-12-01T23:00:00.000Z',
      endTime: '2026-12-02T01:00:00.000Z',
      capacity: 8,
    },
    {
      title: 'Week two: pulling',
      startTime: '2026-12-08T23:00:00.000Z',
      endTime: '2026-12-09T01:00:00.000Z',
    },
  ],
};

describe('writing up an offering, through the whitelist', () => {
  it('accepts everything the create form sends', async () => {
    await expect(create(CREATE_FORM_BODY)).resolves.toMatchObject({
      kind: 'WORKSHOP',
      title: 'Beginner wheel throwing',
      priceCents: null,
    });
  });

  it('accepts a workshop that arrives with its dates', async () => {
    const parsed = (await create(WITH_DATES)) as { sessions: unknown[] };

    expect(parsed.sessions).toHaveLength(2);
    expect(parsed.sessions[0]).toMatchObject({
      title: 'Week one: centring',
      capacity: 8,
    });
  });

  /**
   * The failure a nested array invites: without `@Type`, the pipe sees plain
   * objects, validates nothing inside them, and `whitelist` strips the lot —
   * so the dates vanish silently and the workshop saves with none.
   */
  it('keeps the fields inside each date rather than stripping them', async () => {
    const parsed = (await create(WITH_DATES)) as {
      sessions: Array<Record<string, unknown>>;
    };

    expect(Object.keys(parsed.sessions[0]).sort()).toEqual([
      'capacity',
      'endTime',
      'startTime',
      'title',
    ]);
    /*
      The second date gave no seat count. The pipe builds a class instance, so
      the key is present and undefined rather than absent — what matters is
      that nothing invented a number, because a capacity of 0 or 1 arriving
      from nowhere would quietly cap a workshop.
    */
    expect(parsed.sessions[1].capacity).toBeUndefined();
  });

  it('refuses a date with no name, rather than saving a nameless evening', async () => {
    await expect(
      create({ ...CREATE_FORM_BODY, sessions: [{ startTime: '2026-12-01T23:00:00.000Z', endTime: '2026-12-02T01:00:00.000Z' }] }),
    ).rejects.toThrow();
  });

  it('refuses a date that is not a date', async () => {
    await expect(
      create({
        ...CREATE_FORM_BODY,
        sessions: [{ title: 'Week one', startTime: 'next Tuesday', endTime: 'later' }],
      }),
    ).rejects.toThrow();
  });

  it('refuses a seat count of zero inside a date', async () => {
    await expect(
      create({
        ...CREATE_FORM_BODY,
        sessions: [{ ...WITH_DATES.sessions[0], capacity: 0 }],
      }),
    ).rejects.toThrow();
  });

  /** A create form with no dates on it is the ordinary case, not an error. */
  it('is happy with no dates at all', async () => {
    await expect(create(CREATE_FORM_BODY)).resolves.toBeDefined();
    await expect(create({ ...CREATE_FORM_BODY, sessions: [] })).resolves.toBeDefined();
  });

  it('stops somebody pasting a whole term in', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      title: `Week ${i + 1}`,
      startTime: '2026-12-01T23:00:00.000Z',
      endTime: '2026-12-02T01:00:00.000Z',
    }));

    await expect(create({ ...CREATE_FORM_BODY, sessions: many })).rejects.toThrow();
  });
});

describe('editing an offering, through the whitelist', () => {
  /**
   * The publish button sends this and nothing else. It is the one that would
   * have been caught had this file existed: `isPublished` is declared on the
   * update DTO only, and sending it to create would reject the whole save.
   */
  it('accepts the publish toggle on its own', async () => {
    await expect(update({ isPublished: true })).resolves.toMatchObject({
      isPublished: true,
    });
  });

  it('accepts everything the edit form sends', async () => {
    await expect(update(CREATE_FORM_BODY)).resolves.toMatchObject({
      title: 'Beginner wheel throwing',
    });
  });

  /**
   * Dates are added from the workshop's own page, one at a time, so the edit
   * DTO does not take them. Declared here so that changing one's mind about
   * that is a decision rather than a surprise.
   */
  it('does not take dates on an edit', async () => {
    await expect(update({ sessions: WITH_DATES.sessions })).rejects.toThrow();
  });

  it('refuses a field neither form sends', async () => {
    await expect(update({ isPublished: true, sneaked: 'in' })).rejects.toThrow();
  });
});
