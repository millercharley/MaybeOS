import { ValidationPipe, ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { CreateEventDto } from '../dto/create-event.dto';

/**
 * The event DTO accepts what the form actually sends.
 *
 * This exists because of a real regression. `priceCents` was added to the
 * schema and to the web form and not to this DTO, and the global
 * ValidationPipe runs with `forbidNonWhitelisted: true` — so every event
 * creation from the form answered 400 "property priceCents should not exist".
 * Nothing caught it: the form rendered correctly, the price quote calculated
 * correctly, and both were verified by looking at the screen. Only pressing
 * the button found it.
 *
 * The lesson these cases encode is narrow and worth keeping: a field the form
 * always sends must be nameable here, and `null` is a value the form sends on
 * purpose — it is how it says "this event is free" rather than "I forgot to
 * ask".
 */
describe('CreateEventDto — what the form sends', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: CreateEventDto as ArgumentMetadata['metatype'],
  };

  const base = {
    title: 'Repair Café',
    startTime: '2027-04-05T14:00:00.000Z',
    endTime: '2027-04-05T16:00:00.000Z',
  };

  it('accepts the exact payload the form builds for a free event', async () => {
    // Every field the form sends, including the nulls, as it sends them.
    await expect(
      pipe.transform(
        {
          ...base,
          description: 'Bring something broken.',
          visibility: 'PUBLIC',
          capacity: 30,
          category: 'Workshop',
          priceCents: null,
          publish: true,
        },
        meta,
      ),
    ).resolves.toBeDefined();
  });

  it('accepts a ticketed event', async () => {
    await expect(
      pipe.transform({ ...base, priceCents: 1000, publish: true }, meta),
    ).resolves.toBeDefined();
  });

  it('accepts a host, which only organisers send', async () => {
    await expect(
      pipe.transform(
        { ...base, hostId: '0e4a4b2e-7a1f-4c9e-9d3a-2f9b1c8e5a10' },
        meta,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses a price below what Stripe will take', async () => {
    // Better here than at checkout, after the event was published and shared.
    await expect(
      pipe.transform({ ...base, priceCents: 25 }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still refuses a field nobody declared', async () => {
    // The whitelist is doing real work and should keep doing it — this is the
    // guard that caught the leak of unknown keys elsewhere.
    await expect(
      pipe.transform({ ...base, somethingInvented: true }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
