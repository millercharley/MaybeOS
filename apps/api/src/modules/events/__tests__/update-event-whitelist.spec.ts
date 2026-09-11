import { ValidationPipe } from '@nestjs/common';
import { UpdateEventDto } from '../dto/create-event.dto';
import { VALIDATION_PIPE_OPTIONS } from '../../../common/validation-options';

/**
 * The event edit form's body must survive the API's whitelist (EVT-21).
 *
 * The whitelist forbids unknown fields, so a single key the form sends that
 * `UpdateEventDto` does not declare rejects the *whole* request — not the
 * field, the save. It has happened twice. First `publish`, fixed by stripping
 * it in `toUpdatePayload`. Then `hasCost`, which the form began sending on
 * 2026-09-02 and which no update DTO ever declared: every edit from the admin
 * events page failed from that day, and the suite stayed green, because
 * nothing ran the form's body through the pipe the API actually uses.
 *
 * This does, with the options production uses rather than a copy of them.
 * The key list mirrors `EventForm`'s submit minus `publish`; it lives in the
 * web package and cannot be imported here, so a new form field has to be
 * added to this list too — which is the point of the list.
 */
const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

const EDIT_FORM_BODY = {
  title: 'Print night',
  description: 'Bring a block.',
  startTime: '2026-10-01T23:00:00.000Z',
  endTime: '2026-10-02T01:00:00.000Z',
  visibility: 'PUBLIC',
  capacity: 30,
  waitlistEnabled: true,
  category: 'Art or expression',
  tags: ['Art or expression'],
  hasCost: true,
  maturityLevel: 'AGES_21_PLUS',
  priceCents: null,
  hostId: '11111111-1111-4111-8111-111111111111',
};

const validate = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: UpdateEventDto });

describe('editing an event through the whitelist', () => {
  it('accepts everything the edit form sends', async () => {
    await expect(validate(EDIT_FORM_BODY)).resolves.toMatchObject({
      hasCost: true,
      maturityLevel: 'AGES_21_PLUS',
    });
  });

  it('still refuses publish, which is why toUpdatePayload strips it', async () => {
    await expect(validate({ ...EDIT_FORM_BODY, publish: true })).rejects.toThrow();
  });

  it('refuses an age the product does not offer', async () => {
    await expect(validate({ maturityLevel: 'AGES_16_PLUS' })).rejects.toThrow();
  });
});
