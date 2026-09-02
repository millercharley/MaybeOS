import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email.service';

/**
 * Every button in a booking email opens a page that can do what it says.
 *
 * All five linked to `/portal/{slug}/rooms`, because one `manageUrl` served
 * them all. So "Reschedule or cancel" — the button on the confirmation email a
 * member actually receives — opened the room list, which offers neither. Found
 * by clicking it in a real email, not by any test: the emails had coverage for
 * how they format times and none for where they point.
 *
 * The templates are private, so these go through the same path production
 * does and read what would have been sent.
 */
describe('booking emails — where the buttons go', () => {
  const ROOMS = 'https://maybeos.org/portal/sunrise/rooms';
  const BOOKINGS = 'https://maybeos.org/member/sunrise/bookings';

  const data = {
    memberName: 'Charles',
    roomName: 'Attic',
    orgName: 'MaybeItsFate',
    title: 'Rehearsal',
    when: 'Tue, Sep 29, 2026, 12:00 PM – 1:00 PM EDT',
    manageUrl: ROOMS,
    bookingsUrl: BOOKINGS,
  };

  /** The HTML that would have been sent, captured from the dev log path. */
  const render = async (
    send: (service: EmailService) => Promise<void>,
  ): Promise<string> => {
    const service = new EmailService({ get: () => undefined } as unknown as ConfigService);
    const logged: string[] = [];
    jest
      .spyOn(service['logger'], 'log')
      .mockImplementation((message: unknown) => logged.push(String(message)));

    await send(service);
    return logged.join('\n');
  };

  it('sends "Reschedule or cancel" to the page with reschedule and cancel', async () => {
    const html = await render((s) => s.sendBookingConfirmed('m@example.org', data));

    expect(html).toContain('Reschedule or cancel');
    expect(html).toContain(BOOKINGS);
    // The room list has neither control on it.
    expect(html).not.toContain(ROOMS);
  });

  it('sends "View your bookings" to the bookings page', async () => {
    const html = await render((s) => s.sendBookingReceived('m@example.org', data));

    expect(html).toContain('View your bookings');
    expect(html).toContain(BOOKINGS);
  });

  it('sends a moved booking to the bookings page too', async () => {
    const html = await render((s) =>
      s.sendBookingRescheduled('m@example.org', { ...data, needsApproval: false }),
    );

    expect(html).toContain('View your bookings');
    expect(html).toContain(BOOKINGS);
  });

  it('sends "Find another time" to the rooms, where times are found', async () => {
    const html = await render((s) => s.sendBookingRejected('m@example.org', data));

    expect(html).toContain('Find another time');
    expect(html).toContain(ROOMS);
  });

  it('sends "Book another time" to the rooms as well', async () => {
    const html = await render((s) => s.sendBookingCanceled('m@example.org', data));

    expect(html).toContain('Book another time');
    expect(html).toContain(ROOMS);
  });

  it('never leaves a button with an empty link', async () => {
    // A missing field renders as "undefined" in the href rather than failing,
    // which is how a broken link ships looking fine in review.
    const html = await render((s) => s.sendBookingConfirmed('m@example.org', data));

    expect(html).not.toContain('href="undefined"');
    expect(html).not.toContain('href=""');
  });
});
