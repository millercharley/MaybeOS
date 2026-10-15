import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email.service';

/**
 * What actually goes on the wire (EML-01 … EML-04).
 *
 * The pure helpers beside this file are tested on their own, and that is not
 * enough: a helper nobody calls passes every test it has. These assert the
 * message Postmark is handed, because the bug being fixed is invisible from
 * inside MaybeOS — Postmark reported `Delivered`, Microsoft accepted with a
 * clean `250`, and the member never saw it.
 */
describe('the message handed to the provider', () => {
  function build(env: Record<string, string> = {}) {
    const config = {
      get: (key: string) =>
        ({ POSTMARK_API_TOKEN: 'token', EMAIL_FROM: 'noreply@maybeos.org', ...env })[key],
    } as unknown as ConfigService;

    const service = new EmailService(config);
    const sendEmail = jest.fn().mockResolvedValue({});
    (service as unknown as { client: unknown }).client = { sendEmail };
    return { service, sendEmail };
  }

  /** The payload of the one and only call made. */
  function sent(sendEmail: jest.Mock): Record<string, unknown> {
    expect(sendEmail).toHaveBeenCalledTimes(1);
    return sendEmail.mock.calls[0][0] as Record<string, unknown>;
  }

  const booking = {
    memberName: 'Ruth',
    roomName: 'The Attic',
    orgName: 'MaybeItsFate',
    when: 'Thursday',
    title: 'Open studio',
    manageUrl: 'https://maybeos.org/rooms',
    bookingsUrl: 'https://maybeos.org/bookings',
  };

  const recap = {
    memberName: 'Ruth',
    orgName: 'MaybeItsFate',
    monthLabel: 'September',
    note: null,
    composed: null,
    showMoney: false,
    figures: {
      members: { total: 436, joined: 4, imported: 0 },
      events: { hosted: 12, checkedIn: 90, eventsWithDoor: 8, expected: 12 },
      money: { month: { totalCents: 0 }, year: { totalCents: 0 } },
      service: null,
      impact: [],
    },
    unsubscribeUrl: 'https://maybeos.org/recap/unsubscribe?token=abc',
  };

  const recapReady = {
    organiserName: 'Charley',
    orgName: 'MaybeItsFate',
    monthLabel: 'September',
    reviewUrl: 'https://maybeos.org/recap/review',
  };

  const digest = {
    memberName: 'Ruth',
    orgName: 'MaybeItsFate',
    events: [
      {
        title: 'Open studio',
        when: 'Thursday, 7pm',
        where: 'The Attic',
        description: null,
        matched: ['printmaking'],
        declaredMatches: ['printmaking'],
        ticketed: false,
        rsvpUrl: 'https://maybeos.org/e/1',
      },
    ],
    unsubscribeUrl: 'https://maybeos.org/radar/unsubscribe?token=abc',
    interestsUrl: 'https://maybeos.org/interests',
  };

  describe('the From header (EML-01)', () => {
    it('names the co-op on a raw send', async () => {
      const { service, sendEmail } = build();
      await service.sendRaw('ruth@outlook.com', 'Your sign-in link', '<p>Hi</p>', undefined, 'MaybeItsFate');

      expect(sent(sendEmail).From).toBe('MaybeItsFate <noreply@maybeos.org>');
    });

    it('names the co-op on a templated send that carries one', async () => {
      const { service, sendEmail } = build();
      await service.sendDoorCode('ruth@outlook.com', {
        memberName: 'Ruth',
        orgName: 'MaybeItsFate',
        pin: '1234',
        profileUrl: 'https://maybeos.org/p',
      });

      expect(sent(sendEmail).From).toBe('MaybeItsFate <noreply@maybeos.org>');
    });

    it('falls back to the platform name rather than a bare address', async () => {
      const { service, sendEmail } = build();
      await service.sendMagicLink('ruth@outlook.com', 'https://maybeos.org/m?token=x');

      expect(sent(sendEmail).From).toBe('MaybeOS <noreply@maybeos.org>');
    });

    it('never sends a From with no display name at all', async () => {
      const { service, sendEmail } = build();
      await service.sendRaw('ruth@outlook.com', 'Subject', '<p>Hi</p>');

      expect(sent(sendEmail).From).not.toBe('noreply@maybeos.org');
      expect(String(sent(sendEmail).From)).toMatch(/ <noreply@maybeos\.org>$/);
    });
  });

  describe('the text part (EML-02)', () => {
    it('is present on a raw send and carries the link', async () => {
      const { service, sendEmail } = build();
      const url = 'https://maybeos.org/magic-link?token=abc';
      await service.sendRaw('ruth@outlook.com', 'Your sign-in link', `<p><a href="${url}">Sign in</a></p>`);

      expect(sent(sendEmail).TextBody).toBe(`Sign in (${url})`);
    });

    it('is present on a templated send', async () => {
      const { service, sendEmail } = build();
      await service.sendMagicLink('ruth@outlook.com', 'https://maybeos.org/m?token=x');

      const text = sent(sendEmail).TextBody as string;
      expect(text.trim().length).toBeGreaterThan(0);
      expect(text).toContain('https://maybeos.org/m?token=x');
      expect(text).not.toMatch(/<[a-z]/i);
    });
  });

  /**
   * Both of a member's addresses, on one message (MEM-19).
   *
   * This was true of `sendRaw` from the start and never of the templated
   * sends, so a booking confirmation reached whichever address happened to
   * be recorded as primary — for an imported member, usually the billing one
   * they do not read. The reasoning that put sign-in links on both addresses
   * applies to every message that tells somebody something they acted on.
   */
  describe('a member with two addresses', () => {
    it('copies the second rather than sending twice', async () => {
      const { service, sendEmail } = build();
      await service.sendBookingConfirmed(
        { primary: 'ruth@outlook.com', also: 'ruth@forum.example' },
        booking,
      );

      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(sent(sendEmail).To).toBe('ruth@outlook.com');
      expect(sent(sendEmail).Cc).toBe('ruth@forum.example');
    });

    it('sends no Cc when there is only one address', async () => {
      const { service, sendEmail } = build();
      await service.sendBookingConfirmed({ primary: 'ruth@outlook.com' }, booking);

      expect(sent(sendEmail)).not.toHaveProperty('Cc');
    });

    it('never copies somebody on their own mail', async () => {
      const { service, sendEmail } = build();
      await service.sendBookingConfirmed(
        { primary: 'ruth@outlook.com', also: 'RUTH@outlook.com' },
        booking,
      );

      expect(sent(sendEmail)).not.toHaveProperty('Cc');
    });

    it('still accepts a plain address, which most callers pass', async () => {
      const { service, sendEmail } = build();
      await service.sendBookingConfirmed('ruth@outlook.com', booking);

      expect(sent(sendEmail).To).toBe('ruth@outlook.com');
      expect(sent(sendEmail)).not.toHaveProperty('Cc');
    });

    it.each([
      ['a door code', (s: EmailService) =>
        s.sendDoorCode({ primary: 'a@b.com', also: 'c@d.com' }, {
          memberName: 'Ruth', orgName: 'MaybeItsFate', pin: '1234',
          profileUrl: 'https://maybeos.org/p',
        })],
      ['the radar digest', (s: EmailService) =>
        s.sendRadarDigest({ primary: 'a@b.com', also: 'c@d.com' }, digest)],
      ['the monthly recap', (s: EmailService) =>
        s.sendRecap({ primary: 'a@b.com', also: 'c@d.com' }, recap)],
    ])('reaches both addresses for %s', async (_what, send) => {
      const { service, sendEmail } = build();
      await send(service);

      expect(sent(sendEmail).Cc).toBe('c@d.com');
    });
  });

  describe('Reply-To (EML-03)', () => {
    it('is set when the co-op has given one', async () => {
      const { service, sendEmail } = build();
      await service.sendRaw(
        'ruth@outlook.com', 'Subject', '<p>Hi</p>', undefined, 'MaybeItsFate',
        'hello@maybeitsfate.com',
      );

      expect(sent(sendEmail).ReplyTo).toBe('hello@maybeitsfate.com');
    });

    it('is absent rather than empty when the co-op has not', async () => {
      const { service, sendEmail } = build();
      await service.sendRaw('ruth@outlook.com', 'Subject', '<p>Hi</p>');

      expect(sent(sendEmail)).not.toHaveProperty('ReplyTo');
    });

    it('is set on a templated send that carries one', async () => {
      const { service, sendEmail } = build();
      await service.sendDoorCode('ruth@outlook.com', {
        memberName: 'Ruth',
        orgName: 'MaybeItsFate',
        pin: '1234',
        profileUrl: 'https://maybeos.org/p',
        replyTo: 'hello@maybeitsfate.com',
      } as never);

      expect(sent(sendEmail).ReplyTo).toBe('hello@maybeitsfate.com');
    });

    /**
     * Sanitised at the point of use, not only at the point of entry.
     *
     * The address is a settings field an organiser typed, and the callers
     * that put it on a payload are spread across six services. One of them
     * passing something unchecked must not be able to end the header early
     * and append headers of its own.
     */
    it.each([
      ['a newline', 'a@b.com\nBcc: attacker@example.com'],
      ['a list', 'a@b.com, attacker@example.com'],
      ['a non-address', 'not-an-address'],
    ])('sends no Reply-To rather than a header containing %s', async (_why, value) => {
      const { service, sendEmail } = build();
      await service.sendRaw(
        'ruth@outlook.com', 'Subject', '<p>Hi</p>', undefined, 'MaybeItsFate', value,
      );

      expect(sent(sendEmail)).not.toHaveProperty('ReplyTo');
    });
  });

  describe('keeping bulk mail off the transactional stream (EML-04)', () => {
    it('sends the digest on the broadcast stream when one is configured', async () => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await service.sendRadarDigest('ruth@outlook.com', digest);

      expect(sent(sendEmail).MessageStream).toBe('broadcast');
    });

    it('gives the digest a List-Unsubscribe header', async () => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await service.sendRadarDigest('ruth@outlook.com', digest);

      expect(sent(sendEmail).Headers).toEqual([
        { Name: 'List-Unsubscribe', Value: `<${digest.unsubscribeUrl}>` },
      ]);
    });

    /**
     * One-click needs an endpoint that answers POST, and the unsubscribe link
     * goes to a page in the web app that answers GET. Advertising it would
     * have every provider POST to a route that refuses.
     */
    it('does not advertise one-click unsubscribe', async () => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await service.sendRadarDigest('ruth@outlook.com', digest);

      const headers = sent(sendEmail).Headers as { Name: string }[];
      expect(headers.map((h) => h.Name)).not.toContain('List-Unsubscribe-Post');
    });

    it('leaves the digest on the default stream until a broadcast stream exists', async () => {
      const { service, sendEmail } = build();
      await service.sendRadarDigest('ruth@outlook.com', digest);

      // Naming a stream Postmark does not have would fail the send outright.
      expect(sent(sendEmail)).not.toHaveProperty('MessageStream');
    });

    it('never moves a sign-in link onto the bulk stream', async () => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await service.sendMagicLink('ruth@outlook.com', 'https://maybeos.org/m?token=x');

      expect(sent(sendEmail)).not.toHaveProperty('MessageStream');
    });

    it('never puts List-Unsubscribe on transactional mail', async () => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await service.sendBookingConfirmed('ruth@outlook.com', booking);

      expect(sent(sendEmail)).not.toHaveProperty('Headers');
    });

    /*
      Which mail is bulk, asserted by sending it.

      The negative above is weaker than it looks on its own — a booking has no
      unsubscribe link, so it would hold even if the classification were
      broken outright. These pin both sides: every scheduled mailing moves,
      and nothing a member's own action triggered moves with it. The sign-in
      link is the one that matters, because it is the message a member cannot
      do without and the whole reason the streams are being separated.
    */
    const bulkSends: [string, (s: EmailService) => Promise<unknown>][] = [
      ['the radar digest', (s) => s.sendRadarDigest('ruth@outlook.com', digest)],
      ['the monthly recap', (s) => s.sendRecap('ruth@outlook.com', recap)],
    ];

    const transactionalSends: [string, (s: EmailService) => Promise<unknown>][] = [
      ['a sign-in link', (s) => s.sendMagicLink('ruth@outlook.com', 'https://maybeos.org/m?t=x')],
      ['a booking confirmation', (s) => s.sendBookingConfirmed('ruth@outlook.com', booking)],
      [
        'a door code',
        (s) =>
          s.sendDoorCode('ruth@outlook.com', {
            memberName: 'Ruth',
            orgName: 'MaybeItsFate',
            pin: '1234',
            profileUrl: 'https://maybeos.org/p',
          }),
      ],
      [
        'the notice that a recap is ready',
        (s) => s.sendRecapReady('admin@maybeitsfate.com', recapReady),
      ],
    ];

    it.each(bulkSends)('moves %s onto the broadcast stream', async (_what, send) => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await send(service);

      expect(sent(sendEmail).MessageStream).toBe('broadcast');
    });

    it.each(transactionalSends)('leaves %s on the transactional stream', async (_what, send) => {
      const { service, sendEmail } = build({ POSTMARK_BROADCAST_STREAM: 'broadcast' });
      await send(service);

      expect(sent(sendEmail)).not.toHaveProperty('MessageStream');
    });

    describe('bulk mail’s own From address (EML-05)', () => {
      it('sends the digest as the broadcast address when one is set', async () => {
        const { service, sendEmail } = build({ EMAIL_FROM_BROADCAST: 'news@maybeos.org' });
        await service.sendRadarDigest('ruth@outlook.com', digest);

        expect(sent(sendEmail).From).toBe('MaybeItsFate <news@maybeos.org>');
      });

      /**
       * The address changes; the name does not. A member who reads
       * "MaybeItsFate" has the same reason to trust a digest as a booking
       * confirmation — the separation is for the receiving end.
       */
      it('still names the co-op in front of it', async () => {
        const { service, sendEmail } = build({ EMAIL_FROM_BROADCAST: 'news@maybeos.org' });
        await service.sendRecap('ruth@outlook.com', recap);

        expect(String(sent(sendEmail).From)).toMatch(/^MaybeItsFate </);
      });

      it.each(transactionalSends)('never sends %s as the broadcast address', async (_what, send) => {
        const { service, sendEmail } = build({ EMAIL_FROM_BROADCAST: 'news@maybeos.org' });
        await send(service);

        expect(String(sent(sendEmail).From)).toContain('<noreply@maybeos.org>');
        expect(String(sent(sendEmail).From)).not.toContain('news@maybeos.org');
      });

      it('keeps bulk mail on the ordinary address until one is set', async () => {
        // An unverified sender is refused by Postmark and the refusal is
        // swallowed into the log, so the unset default must be the old
        // behaviour rather than a guess at an address.
        const { service, sendEmail } = build();
        await service.sendRadarDigest('ruth@outlook.com', digest);

        expect(sent(sendEmail).From).toBe('MaybeItsFate <noreply@maybeos.org>');
      });
    });
  });
});
